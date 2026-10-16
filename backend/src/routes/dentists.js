import { tx } from "../db.js";
import { HttpError, conflict, forbidden, invalid, notFound } from "../lib/errors.js";
import { created, requireAuth, requireRole } from "../lib/router.js";
import { hashPassword } from "../lib/security.js";
import { addDays, clinicNow, toMin } from "../lib/time.js";
import { isDate, parse, parseQuery } from "../lib/validate.js";
import { getDaySlots, getServiceOrThrow } from "../services/scheduling.js";
import { dentistOfUser } from "../services/lookup.js";

const DEFAULT_HOURS = [[9, 12], [13, 17]];

function dentistView(db, d, { admin = false } = {}) {
  const u = db.prepare("SELECT full_name, email, phone FROM users WHERE id = ?").get(d.user_id);
  const weekly = db.prepare("SELECT weekday, start_time, end_time FROM dentist_schedules WHERE dentist_id = ? ORDER BY weekday, start_time").all(d.id);
  return {
    id: d.id,
    name: u.full_name,
    specialty: d.specialty,
    bio: d.bio,
    status: d.status,
    active: Boolean(d.active),
    schedule: weekly.map((w) => ({ weekday: w.weekday, startTime: w.start_time, endTime: w.end_time })),
    ...(admin ? { email: u.email, phone: u.phone, userId: d.user_id } : {}),
  };
}

function resolveDentist(ctx, { allowInactive = false } = {}) {
  let d;
  if (ctx.params.id === "me") {
    if (!["dentist", "admin"].includes(ctx.user?.role)) throw forbidden("Only the dentist can use /me");
    d = dentistOfUser(ctx.db, ctx.user.id);
  } else {
    d = ctx.db.prepare("SELECT * FROM dentists WHERE id = ?").get(ctx.params.id);
  }
  if (!d || (!d.active && !allowInactive)) throw notFound("Dentist");
  return d;
}
const assertCanManage = (ctx, d) => {
  if (ctx.user.role === "admin") return;
  if (ctx.user.role === "dentist" && d.user_id === ctx.user.id) return;
  throw forbidden("You can only manage your own schedule");
};

function replaceSchedule(db, dentistId, blocks) {
  db.prepare("DELETE FROM dentist_schedules WHERE dentist_id = ?").run(dentistId);
  const ins = db.prepare("INSERT INTO dentist_schedules (dentist_id, weekday, start_time, end_time) VALUES (?,?,?,?)");
  for (const b of blocks) ins.run(dentistId, b.weekday, b.startTime, b.endTime);
}

export default function register(router) {
  router.get("/api/dentists", (ctx) => {
    const admin = ctx.user?.role === "admin";
    const includeInactive = admin && ctx.query.includeInactive === "1";
    const rows = ctx.db.prepare(
      `SELECT d.* FROM dentists d JOIN users u ON u.id = d.user_id ${includeInactive ? "" : "WHERE d.active = 1"} ORDER BY u.full_name`,
    ).all();
    return { items: rows.map((d) => dentistView(ctx.db, d, { admin })) };
  });

  router.post("/api/dentists", requireRole("admin"), (ctx) => {
    const data = parse(ctx.body, {
      fullName: { type: "string", required: true, min: 2, max: 120 },
      email: { type: "email", required: true },
      password: { type: "password", required: true },
      phone: { type: "phone" },
      specialty: { type: "string", max: 100, default: "General Dentistry" },
      bio: { type: "string", max: 1000, default: "" },
    });
    const id = tx(ctx.db, () => {
      if (ctx.db.prepare("SELECT 1 FROM users WHERE email = ?").get(data.email)) {
        throw new HttpError(409, "email_taken", "An account with this email already exists", { email: "Already registered" });
      }
      const u = ctx.db.prepare("INSERT INTO users (role, email, password_hash, full_name, phone) VALUES ('dentist',?,?,?,?)")
        .run(data.email, hashPassword(data.password), data.fullName, data.phone ?? null);
      const d = ctx.db.prepare("INSERT INTO dentists (user_id, specialty, bio) VALUES (?,?,?)").run(u.lastInsertRowid, data.specialty, data.bio);
      const blocks = [];
      for (let wd = 1; wd <= 5; wd++) for (const [s, e] of DEFAULT_HOURS) blocks.push({ weekday: wd, startTime: `${String(s).padStart(2, "0")}:00`, endTime: `${String(e).padStart(2, "0")}:00` });
      replaceSchedule(ctx.db, d.lastInsertRowid, blocks);
      return d.lastInsertRowid;
    });
    return created(dentistView(ctx.db, ctx.db.prepare("SELECT * FROM dentists WHERE id = ?").get(id), { admin: true }));
  });

  router.get("/api/dentists/:id", (ctx) => dentistView(ctx.db, resolveDentist(ctx), { admin: ctx.user?.role === "admin" }));

  router.patch("/api/dentists/:id", requireRole("admin"), (ctx) => {
    const d = resolveDentist(ctx, { allowInactive: true });
    const data = parse(ctx.body, {
      fullName: { type: "string", min: 2, max: 120 },
      phone: { type: "phone" },
      specialty: { type: "string", max: 100 },
      bio: { type: "string", max: 1000 },
      active: { type: "bool" },
    });
    tx(ctx.db, () => {
      ctx.db.prepare("UPDATE dentists SET specialty = ?, bio = ?, active = ? WHERE id = ?")
        .run(data.specialty ?? d.specialty, data.bio ?? d.bio, data.active === undefined ? d.active : Number(data.active), d.id);
      if (data.fullName) ctx.db.prepare("UPDATE users SET full_name = ? WHERE id = ?").run(data.fullName, d.user_id);
      if (data.phone) ctx.db.prepare("UPDATE users SET phone = ? WHERE id = ?").run(data.phone, d.user_id);
      if (data.active === false) ctx.db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(d.user_id);
      if (data.active === true) ctx.db.prepare("UPDATE users SET active = 1 WHERE id = ?").run(d.user_id);
    });
    return dentistView(ctx.db, ctx.db.prepare("SELECT * FROM dentists WHERE id = ?").get(d.id), { admin: true });
  });

  // Duty status toggle: Available / On Break / Off Duty
  router.patch("/api/dentists/:id/status", requireAuth, (ctx) => {
    const d = resolveDentist(ctx);
    assertCanManage(ctx, d);
    const { status } = parse(ctx.body, { status: { type: "enum", values: ["available", "on_break", "off_duty"], required: true } });
    ctx.db.prepare("UPDATE dentists SET status = ? WHERE id = ?").run(status, d.id);
    ctx.hub.toAll("dentist.status", { dentistId: d.id, status });
    return { id: d.id, status };
  });

  // ---- availability (drives the booking calendar & time slots) ----
  router.get("/api/dentists/:id/availability", (ctx) => {
    const d = resolveDentist(ctx);
    const q = parseQuery(ctx.query, { date: { type: "date", required: true }, serviceId: { type: "int", required: true } });
    const service = getServiceOrThrow(ctx.db, q.serviceId);
    const day = getDaySlots(ctx.app, { dentistId: d.id, date: q.date, durationMin: service.duration_min, holdOwnerUserId: ctx.user?.id ?? 0 });
    return { date: q.date, dentistId: d.id, service: { id: service.id, name: service.name, durationMin: service.duration_min }, ...day };
  });

  router.get("/api/dentists/:id/availability/calendar", (ctx) => {
    const d = resolveDentist(ctx);
    const q = parseQuery(ctx.query, { month: { type: "string", required: true, min: 7, max: 7 }, serviceId: { type: "int", required: true } });
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(q.month)) throw invalid("month must be YYYY-MM", { month: "Invalid month" });
    const service = getServiceOrThrow(ctx.db, q.serviceId);
    const days = [];
    for (let date = `${q.month}-01`; date.startsWith(q.month); date = addDays(date, 1)) {
      const day = getDaySlots(ctx.app, { dentistId: d.id, date, durationMin: service.duration_min, holdOwnerUserId: ctx.user?.id ?? 0 });
      days.push({ date, dayStatus: day.dayStatus, availableSlots: day.slots.filter((s) => s.available).length });
    }
    return { month: q.month, dentistId: d.id, days };
  });

  // ---- weekly schedule & time off (dentist portal) ----
  router.get("/api/dentists/:id/schedule", (ctx) => {
    const d = resolveDentist(ctx);
    const today = clinicNow(ctx.config).date;
    const timeOff = ctx.db.prepare("SELECT date, reason FROM dentist_time_off WHERE dentist_id = ? AND date >= ? ORDER BY date").all(d.id, today);
    return { dentistId: d.id, weekly: dentistView(ctx.db, d).schedule, timeOff };
  });

  router.put("/api/dentists/:id/schedule", requireAuth, (ctx) => {
    const d = resolveDentist(ctx);
    assertCanManage(ctx, d);
    if (!Array.isArray(ctx.body?.blocks) || ctx.body.blocks.length > 50) throw invalid("blocks must be an array (max 50)");
    const blocks = ctx.body.blocks.map((b, i) => {
      try { return parse(b, { weekday: { type: "int", required: true, min: 0, max: 6 }, startTime: { type: "time", required: true }, endTime: { type: "time", required: true } }); }
      catch (e) { throw invalid(`Invalid block at index ${i}`, e.details); }
    });
    for (const b of blocks) if (b.startTime >= b.endTime) throw invalid("startTime must be before endTime", { weekday: b.weekday });
    const sorted = [...blocks].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].weekday === sorted[i - 1].weekday && toMin(sorted[i].startTime) < toMin(sorted[i - 1].endTime)) {
        throw invalid("Schedule blocks overlap on the same day", { weekday: sorted[i].weekday });
      }
    }
    tx(ctx.db, () => replaceSchedule(ctx.db, d.id, sorted));
    // Warn about already-booked future appointments that now fall outside working hours
    const today = clinicNow(ctx.config).date;
    const future = ctx.db.prepare(
      "SELECT id, reference, date, start_time, end_time FROM appointments WHERE dentist_id = ? AND date >= ? AND status IN ('pending','confirmed')",
    ).all(d.id, today);
    const affected = future.filter((a) => {
      const wd = new Date(`${a.date}T00:00:00Z`).getUTCDay();
      return !sorted.some((b) => b.weekday === wd && b.startTime <= a.start_time && b.endTime >= a.end_time);
    });
    return { weekly: dentistView(ctx.db, d).schedule, affectedAppointments: affected.map((a) => ({ id: a.id, reference: a.reference, date: a.date, startTime: a.start_time })) };
  });

  router.post("/api/dentists/:id/time-off", requireAuth, (ctx) => {
    const d = resolveDentist(ctx);
    assertCanManage(ctx, d);
    const data = parse(ctx.body, { date: { type: "date", required: true }, reason: { type: "string", max: 200 }, force: { type: "bool" } });
    if (data.date < clinicNow(ctx.config).date) throw invalid("Date is in the past", { date: "Choose today or later" });
    const booked = ctx.db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE dentist_id = ? AND date = ? AND status IN ('pending','confirmed')").get(d.id, data.date).n;
    if (booked && !data.force) {
      throw conflict("has_appointments", `${booked} appointment(s) are already booked on this date. Resend with force:true to block the day anyway, then decline/reschedule them.`, { count: booked });
    }
    ctx.db.prepare("INSERT OR REPLACE INTO dentist_time_off (dentist_id, date, reason) VALUES (?,?,?)").run(d.id, data.date, data.reason ?? null);
    return created({ date: data.date, reason: data.reason ?? null, affectedAppointments: booked });
  });

  router.delete("/api/dentists/:id/time-off/:date", requireAuth, (ctx) => {
    const d = resolveDentist(ctx);
    assertCanManage(ctx, d);
    if (!isDate(ctx.params.date)) throw invalid("Invalid date");
    const r = ctx.db.prepare("DELETE FROM dentist_time_off WHERE dentist_id = ? AND date = ?").run(d.id, ctx.params.date);
    if (!r.changes) throw notFound("Time-off entry");
    return undefined;
  });
}
