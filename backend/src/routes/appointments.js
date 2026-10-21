import { tx } from "../db.js";
import { conflict, forbidden, invalid, notFound } from "../lib/errors.js";
import { created, requireAuth, requireRole } from "../lib/router.js";
import { randomCode } from "../lib/security.js";
import { clinicNow, fromMin, toMin } from "../lib/time.js";
import { parse, parseQuery } from "../lib/validate.js";
import {
  APPT_SELECT, appointmentView, dentistOfUser, getAppointmentRow, getPatientOrThrow, patientOfUser, requirePatientProfile,
} from "../services/lookup.js";
import {
  assertPatientFree, assertServiceDentist, assertSlotBookable, BOOKING_DURATION_MIN, getDentistOrThrow, getServiceOrThrow, purgeExpiredHolds,
} from "../services/scheduling.js";

// from-status -> allowed next statuses
const TRANSITIONS = {
  pending: ["confirmed", "declined", "cancelled"],
  confirmed: ["completed", "no_show", "cancelled"],
};
// who may set which status
const ROLE_CAN_SET = {
  patient: ["cancelled"],
  dentist: ["confirmed", "declined", "completed", "no_show", "cancelled"],
  clerk: ["confirmed", "cancelled", "completed", "no_show"],
  admin: ["confirmed", "declined", "completed", "no_show", "cancelled"],
};

function newReference(db) {
  for (let i = 0; i < 8; i++) {
    const ref = `SC-${randomCode(6)}`;
    if (!db.prepare("SELECT 1 FROM appointments WHERE reference = ?").get(ref)) return ref;
  }
  throw new Error("Could not generate a unique reference");
}

function canAccess(ctx, row) {
  const { user, db } = ctx;
  if (user.role === "admin" || user.role === "clerk") return true;
  if (user.role === "patient") return patientOfUser(db, user.id)?.id === row.patient_id;
  if (user.role === "dentist") return dentistOfUser(db, user.id)?.id === row.dentist_id;
  return false;
}

function notify(ctx, row, event = "appointment.updated") {
  const payload = { id: row.id, reference: row.reference, status: row.status, date: row.date, startTime: row.start_time };
  const pu = ctx.db.prepare("SELECT user_id FROM patients WHERE id = ?").get(row.patient_id)?.user_id;
  const du = ctx.db.prepare("SELECT user_id FROM dentists WHERE id = ?").get(row.dentist_id)?.user_id;
  if (pu) ctx.hub.toUser(pu, event, payload);
  if (du) ctx.hub.toUser(du, event, payload);
  ctx.hub.toRoles(["clerk", "admin"], event, payload);
}

function consumeHold(ctx, holdId, { dentistId, date, startTime }) {
  purgeExpiredHolds(ctx.db, ctx.config);
  const h = ctx.db.prepare("SELECT * FROM slot_holds WHERE id = ? AND user_id = ?").get(holdId, ctx.user.id);
  if (!h) throw conflict("hold_expired", "Your reserved slot expired. Please choose a time again.");
  if (h.dentist_id !== dentistId || h.date !== date || h.start_time !== startTime) {
    throw invalid("The reserved slot does not match this booking", { holdId: "Mismatch" });
  }
  return h;
}

export default function register(router) {
  // ---------- slot holds (reservation countdown while filling the form) ----------
  router.post("/api/slot-holds", requireRole("patient", "clerk", "admin"), (ctx) => {
    const d = parse(ctx.body, {
      serviceId: { type: "int", required: true }, dentistId: { type: "int", required: true },
      date: { type: "date", required: true }, startTime: { type: "time", required: true },
    });
    const service = getServiceOrThrow(ctx.db, d.serviceId);
    getDentistOrThrow(ctx.db, d.dentistId);
    assertServiceDentist(ctx.db, service, d.dentistId);
    const hold = tx(ctx.db, () => {
      assertSlotBookable(ctx.app, { dentistId: d.dentistId, date: d.date, startTime: d.startTime, holdOwnerUserId: ctx.user.id });
      ctx.db.prepare("DELETE FROM slot_holds WHERE user_id = ?").run(ctx.user.id);
      const expiresAt = ctx.config.clock().getTime() + ctx.config.slotHoldMin * 60_000;
      const r = ctx.db.prepare("INSERT INTO slot_holds (user_id, dentist_id, date, start_time, end_time, expires_at) VALUES (?,?,?,?,?,?)")
        .run(ctx.user.id, d.dentistId, d.date, d.startTime, fromMin(toMin(d.startTime) + BOOKING_DURATION_MIN), expiresAt);
      return { id: Number(r.lastInsertRowid), expiresAt };
    });
    return created({ id: hold.id, expiresAt: new Date(hold.expiresAt).toISOString(), secondsLeft: ctx.config.slotHoldMin * 60 });
  });

  router.delete("/api/slot-holds/:id", requireRole("patient", "clerk", "admin"), (ctx) => {
    ctx.db.prepare("DELETE FROM slot_holds WHERE id = ? AND user_id = ?").run(ctx.params.id, ctx.user.id);
    return undefined;
  });

  // ---------- create ----------
  router.post("/api/appointments", requireRole("patient", "clerk", "admin"), (ctx) => {
    const d = parse(ctx.body, {
      serviceId: { type: "int", required: true }, dentistId: { type: "int", required: true },
      date: { type: "date", required: true }, startTime: { type: "time", required: true },
      notes: { type: "string", max: 500 }, holdId: { type: "int" },
      patientId: { type: "int" }, source: { type: "enum", values: ["walk_in", "messenger"] },
    });

    let patient, source, status;
    if (ctx.user.role === "patient") {
      patient = requirePatientProfile(ctx.db, ctx.user);
      source = "online_portal"; status = "pending"; // dentist/clinic confirms booking requests
    } else {
      if (!d.patientId) throw invalid("patientId is required", { patientId: "Required" });
      patient = getPatientOrThrow(ctx.db, d.patientId);
      source = d.source ?? "walk_in"; status = "confirmed"; // staff-entered bookings are confirmed immediately
    }

    const row = tx(ctx.db, () => {
      const service = getServiceOrThrow(ctx.db, d.serviceId);
      getDentistOrThrow(ctx.db, d.dentistId);
      assertServiceDentist(ctx.db, service, d.dentistId);
      if (d.holdId) consumeHold(ctx, d.holdId, d);
      assertSlotBookable(ctx.app, { dentistId: d.dentistId, date: d.date, startTime: d.startTime, holdOwnerUserId: ctx.user.id });
      const endTime = fromMin(toMin(d.startTime) + BOOKING_DURATION_MIN);
      assertPatientFree(ctx.db, { patientId: patient.id, date: d.date, startTime: d.startTime, endTime });
      const r = ctx.db.prepare(
        `INSERT INTO appointments (reference, patient_id, dentist_id, service_id, date, start_time, end_time, status, source, notes, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(newReference(ctx.db), patient.id, d.dentistId, d.serviceId, d.date, d.startTime, endTime, status, source, d.notes ?? null, ctx.user.id);
      ctx.db.prepare("DELETE FROM slot_holds WHERE user_id = ?").run(ctx.user.id);
      return getAppointmentRow(ctx.db, r.lastInsertRowid);
    });
    notify(ctx, row, "appointment.created");
    return created(appointmentView(row));
  });

  // ---------- list ----------
  router.get("/api/appointments", requireAuth, (ctx) => {
    const q = parseQuery(ctx.query, {
      scope: { type: "enum", values: ["upcoming", "past"] },
      status: { type: "string", max: 100 },
      date: { type: "date" }, from: { type: "date" }, to: { type: "date" },
      year: { type: "int", min: 2000, max: 2100 },
      dentistId: { type: "int" }, patientId: { type: "int" },
      q: { type: "string", max: 100 },
      order: { type: "enum", values: ["asc", "desc"] },
      page: { type: "int", min: 1, default: 1 },
      pageSize: { type: "int", min: 1, max: 100, default: 20 },
    });
    const where = [];
    const args = [];
    const today = clinicNow(ctx.config).date;

    if (ctx.user.role === "patient") { where.push("a.patient_id = ?"); args.push(requirePatientProfile(ctx.db, ctx.user).id); }
    else if (ctx.user.role === "dentist") { where.push("a.dentist_id = ?"); args.push(dentistOfUser(ctx.db, ctx.user.id).id); }
    else {
      where.push("p.is_demo = 0");
      if (q.dentistId) { where.push("a.dentist_id = ?"); args.push(q.dentistId); }
      if (q.patientId) { where.push("a.patient_id = ?"); args.push(q.patientId); }
    }
    if (q.scope === "upcoming") { where.push("a.date >= ? AND a.status IN ('pending','confirmed')"); args.push(today); }
    if (q.scope === "past") { where.push("(a.date < ? OR a.status NOT IN ('pending','confirmed'))"); args.push(today); }
    if (q.status) {
      const list = q.status.split(",").map((s) => s.trim()).filter(Boolean);
      const allowed = ["pending", "confirmed", "declined", "cancelled", "completed", "no_show"];
      if (list.some((s) => !allowed.includes(s))) throw invalid("Invalid status filter", { status: `Use: ${allowed.join(", ")}` });
      where.push(`a.status IN (${list.map(() => "?").join(",")})`); args.push(...list);
    }
    if (q.date) { where.push("a.date = ?"); args.push(q.date); }
    if (q.from) { where.push("a.date >= ?"); args.push(q.from); }
    if (q.to) { where.push("a.date <= ?"); args.push(q.to); }
    if (q.year) { where.push("substr(a.date,1,4) = ?"); args.push(String(q.year)); }
    if (q.q) {
      where.push("(a.reference LIKE ? OR p.full_name LIKE ? OR s.name LIKE ? OR du.full_name LIKE ?)");
      args.push(...Array(4).fill(`%${q.q}%`));
    }
    const order = (q.order ?? (q.scope === "upcoming" ? "asc" : "desc")).toUpperCase();
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = ctx.db.prepare(`SELECT COUNT(*) AS n FROM (${APPT_SELECT} ${clause})`).get(...args).n;
    const rows = ctx.db.prepare(`${APPT_SELECT} ${clause} ORDER BY a.date ${order}, a.start_time ${order} LIMIT ? OFFSET ?`)
      .all(...args, q.pageSize, (q.page - 1) * q.pageSize);
    const items = rows.map((row) => {
      if (ctx.user.role !== "patient") return appointmentView(row);
      const review = ctx.db.prepare(
        "SELECT rating, comment, is_public, created_at FROM dentist_reviews WHERE appointment_id = ? AND patient_id = ?",
      ).get(row.id, row.patient_id);
      return appointmentView(row, review ? {
        rating: review.rating,
        comment: review.comment,
        isPublic: Boolean(review.is_public),
        createdAt: review.created_at,
      } : null);
    });
    return { items, total, page: q.page, pageSize: q.pageSize };
  });

  router.post("/api/appointments/:id/review", requireRole("patient"), (ctx) => {
    const data = parse(ctx.body, {
      rating: { type: "int", required: true, min: 1, max: 5 },
      comment: { type: "string", max: 1000 },
      isPublic: { type: "bool" },
    });
    const patient = requirePatientProfile(ctx.db, ctx.user);
    const appointment = getAppointmentRow(ctx.db, ctx.params.id);
    if (appointment.patient_id !== patient.id) throw notFound("Appointment");
    if (appointment.status !== "completed") {
      throw conflict("review_not_allowed", "You can review an appointment after the clinic marks it completed.");
    }
    const comment = data.comment ?? "";
    if (data.isPublic && !comment.trim()) {
      throw invalid("Add a comment before choosing to publish it", { comment: "A public comment cannot be blank" });
    }
    const result = ctx.db.prepare(
      `INSERT INTO dentist_reviews (appointment_id, patient_id, dentist_id, rating, comment, is_public)
       VALUES (?,?,?,?,?,?)`,
    ).run(appointment.id, patient.id, appointment.dentist_id, data.rating, comment, Number(Boolean(data.isPublic && comment.trim())));
    const review = {
      id: Number(result.lastInsertRowid),
      dentistId: appointment.dentist_id,
      rating: data.rating,
      comment,
      isPublic: Boolean(data.isPublic && comment.trim()),
      createdAt: new Date().toISOString(),
    };
    ctx.hub.toCatalog("dentist.review.updated", { dentistId: appointment.dentist_id });
    return created(review);
  });

  router.get("/api/appointments/:id", requireAuth, (ctx) => {
    const row = getAppointmentRow(ctx.db, ctx.params.id);
    if (!canAccess(ctx, row)) throw notFound("Appointment"); // don't reveal existence
    return appointmentView(row);
  });

  // ---------- status changes: confirm / decline / cancel / complete / no-show ----------
  router.patch("/api/appointments/:id/status", requireAuth, (ctx) => {
    const { status, reason } = parse(ctx.body, {
      status: { type: "enum", values: ["confirmed", "declined", "cancelled", "completed", "no_show"], required: true },
      reason: { type: "string", max: 300 },
    });
    const row = getAppointmentRow(ctx.db, ctx.params.id);
    if (!canAccess(ctx, row)) throw notFound("Appointment");
    if (!ROLE_CAN_SET[ctx.user.role]?.includes(status)) throw forbidden(`Your role cannot set status "${status}"`);
    if (!TRANSITIONS[row.status]?.includes(status)) {
      throw conflict("invalid_transition", `Cannot change an appointment from "${row.status}" to "${status}"`);
    }
    if (
      status === "confirmed" &&
      row.source === "online_portal" &&
      ctx.db.prepare("SELECT 1 FROM appointment_payments WHERE appointment_id = ? AND status = 'paid'").get(row.id) === undefined
    ) {
      throw conflict("deposit_required", "The 50% online booking deposit must be paid before confirmation.");
    }
    const now = clinicNow(ctx.config);
    const startsAt = `${row.date} ${row.start_time}`;
    if ((status === "completed" || status === "no_show") && startsAt > `${now.date} ${now.time}` && row.date !== now.date) {
      throw conflict("too_early", "Only today's or past appointments can be marked completed or no-show");
    }
    if (ctx.user.role === "patient" && startsAt <= `${now.date} ${now.time}`) {
      throw conflict("too_late", "This appointment has already started. Please contact the clinic.");
    }
    ctx.db.prepare("UPDATE appointments SET status = ?, status_reason = ?, updated_at = datetime('now') WHERE id = ?").run(status, reason ?? null, row.id);
    const updated = getAppointmentRow(ctx.db, row.id);
    notify(ctx, updated);
    return appointmentView(updated);
  });

  // ---------- reschedule ----------
  router.post("/api/appointments/:id/reschedule", requireRole("patient", "clerk", "admin"), (ctx) => {
    const d = parse(ctx.body, {
      date: { type: "date", required: true }, startTime: { type: "time", required: true },
      dentistId: { type: "int" }, holdId: { type: "int" },
    });
    const updated = tx(ctx.db, () => {
      const row = getAppointmentRow(ctx.db, ctx.params.id);
      if (!canAccess(ctx, row)) throw notFound("Appointment");
      if (!["pending", "confirmed"].includes(row.status)) throw conflict("invalid_transition", "Only pending or confirmed appointments can be rescheduled");
      const now = clinicNow(ctx.config);
      if (`${row.date} ${row.start_time}` <= `${now.date} ${now.time}`) throw conflict("too_late", "This appointment has already started");
      const dentistId = d.dentistId ?? row.dentist_id;
      getDentistOrThrow(ctx.db, dentistId);
      assertServiceDentist(ctx.db, getServiceOrThrow(ctx.db, row.service_id), dentistId);
      if (d.holdId) consumeHold(ctx, d.holdId, { dentistId, date: d.date, startTime: d.startTime });
      assertSlotBookable(ctx.app, { dentistId, date: d.date, startTime: d.startTime, holdOwnerUserId: ctx.user.id, ignoreApptId: row.id });
      const endTime = fromMin(toMin(d.startTime) + BOOKING_DURATION_MIN);
      assertPatientFree(ctx.db, { patientId: row.patient_id, date: d.date, startTime: d.startTime, endTime, ignoreApptId: row.id });
      // A patient-initiated change goes back to the dentist for confirmation; staff changes stay as-is
      const status = ctx.user.role === "patient" ? "pending" : row.status;
      ctx.db.prepare("UPDATE appointments SET dentist_id=?, date=?, start_time=?, end_time=?, status=?, updated_at=datetime('now') WHERE id=?")
        .run(dentistId, d.date, d.startTime, endTime, status, row.id);
      ctx.db.prepare("DELETE FROM slot_holds WHERE user_id = ?").run(ctx.user.id);
      return getAppointmentRow(ctx.db, row.id);
    });
    notify(ctx, updated);
    return appointmentView(updated);
  });
}
