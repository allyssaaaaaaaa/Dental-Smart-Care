import { conflict, invalid, notFound } from "../lib/errors.js";
import { addDays, clinicNow, fromMin, overlaps, toMin, weekdayOf } from "../lib/time.js";

export const ACTIVE_STATUSES = ["pending", "confirmed"];
export const BOOKING_DURATION_MIN = 60;
const BOOKING_STEP_MIN = 60;
const MAX_BOOKING_ADVANCE_DAYS = 90;

export function purgeExpiredHolds(db, config) {
  db.prepare("DELETE FROM slot_holds WHERE expires_at <= ?").run(config.clock().getTime());
}

export function getDentistOrThrow(db, dentistId) {
  const d = db.prepare("SELECT * FROM dentists WHERE id = ? AND active = 1").get(dentistId);
  if (!d) throw notFound("Dentist");
  return d;
}
export function getServiceOrThrow(db, serviceId) {
  const s = db.prepare("SELECT * FROM services WHERE id = ? AND active = 1").get(serviceId);
  if (!s) throw notFound("Service");
  return s;
}

export function assertServiceDentist(db, service, dentistId) {
  if (!/ortho|braces/i.test(`${service.name} ${service.category}`)) return;
  const dentist = db.prepare(
    "SELECT u.full_name FROM dentists d JOIN users u ON u.id = d.user_id WHERE d.id = ? AND d.active = 1",
  ).get(dentistId);
  if (!dentist || !/petil/i.test(dentist.full_name)) {
    throw invalid("Orthodontic and braces services are only available with Doc Petil", {
      dentistId: "Choose Doc Petil for this service",
    });
  }
}

/** 
 * Bookable start times are reserved in one-hour blocks, regardless of procedure duration.
 * Booked / held / past slots are returned with available:false so the UI can render them disabled.
 */
export function getDaySlots(app, { dentistId, date, durationMin, holdOwnerUserId = 0, ignoreApptId = 0 }) {
  const { db, config } = app;
  purgeExpiredHolds(db, config);
  const now = clinicNow(config);

  if (date > addDays(now.date, Math.min(config.maxAdvanceDays, MAX_BOOKING_ADVANCE_DAYS))) {
    return { slots: [], dayStatus: "outside_booking_window" };
  }

  const blocks = db
    .prepare("SELECT start_time, end_time FROM dentist_schedules WHERE dentist_id = ? AND weekday = ? ORDER BY start_time")
    .all(dentistId, weekdayOf(date));
  const timeOff = db.prepare("SELECT reason FROM dentist_time_off WHERE dentist_id = ? AND date = ?").get(dentistId, date);
  if (timeOff) return { slots: [], dayStatus: "time_off", reason: timeOff.reason ?? null };
  if (!blocks.length) return { slots: [], dayStatus: "closed" };

  const busy = [
    ...db.prepare(
      `SELECT start_time, end_time FROM appointments
       WHERE dentist_id = ? AND date = ? AND status IN ('pending','confirmed') AND id != ?`,
    ).all(dentistId, date, ignoreApptId),
    ...db.prepare(
      `SELECT start_time, end_time FROM slot_holds
       WHERE dentist_id = ? AND date = ? AND expires_at > ? AND user_id != ?`,
    ).all(dentistId, date, config.clock().getTime(), holdOwnerUserId),
  ].map((b) => [toMin(b.start_time), toMin(b.end_time)]);

  const nowMin = toMin(now.time);
  const slots = [];
  for (const block of blocks) {
    const bs = toMin(block.start_time);
    const be = toMin(block.end_time);
    for (let s = bs; s + BOOKING_DURATION_MIN <= be; s += BOOKING_STEP_MIN) {
      const e = s + BOOKING_DURATION_MIN;
      let available = true;
      let reason;
      if (date < now.date || (date === now.date && s < nowMin + config.minLeadMin)) {
        available = false; reason = "past";
      } else if (busy.some(([bS, bE]) => overlaps(s, e, bS, bE))) {
        available = false; reason = "booked";
      }
      slots.push({ startTime: fromMin(s), endTime: fromMin(e), available, ...(reason ? { reason } : {}) });
    }
  }
  return { slots, dayStatus: "open" };
}

export function assertWithinBookingWindow(app, date) {
  const now = clinicNow(app.config);
  if (date < now.date) throw invalid("Date is in the past", { date: "Choose today or a future date" });
  const maxAdvanceDays = Math.min(app.config.maxAdvanceDays, MAX_BOOKING_ADVANCE_DAYS);
  if (date > addDays(now.date, maxAdvanceDays)) {
    throw invalid("Date is too far ahead", { date: `Bookings open up to ${maxAdvanceDays} days in advance` });
  }
}

/** Throws a descriptive error unless `startTime` is a free slot. Returns the slot. */
export function assertSlotBookable(app, { dentistId, date, startTime, holdOwnerUserId = 0, ignoreApptId = 0 }) {
  assertWithinBookingWindow(app, date);
  const { slots, dayStatus, reason } = getDaySlots(app, { dentistId, date, durationMin: BOOKING_DURATION_MIN, holdOwnerUserId, ignoreApptId });
  if (dayStatus === "time_off") throw conflict("dentist_unavailable", "The dentist is not available on this date", { reason });
  const slot = slots.find((s) => s.startTime === startTime);
  if (!slot) throw invalid("That time is outside the dentist's working hours for this service", { startTime: "Not an offered time slot" });
  if (!slot.available) {
    throw conflict(
      slot.reason === "past" ? "slot_in_past" : "slot_unavailable",
      slot.reason === "past" ? "That time has already passed or is too soon to book" : "That time slot was just taken. Please pick another.",
    );
  }
  return slot;
}

export function assertPatientFree(db, { patientId, date, startTime, endTime, ignoreApptId = 0 }) {
  const rows = db.prepare(
    `SELECT start_time, end_time FROM appointments
     WHERE patient_id = ? AND date = ? AND status IN ('pending','confirmed') AND id != ?`,
  ).all(patientId, date, ignoreApptId);
  if (rows.some((r) => overlaps(toMin(startTime), toMin(endTime), toMin(r.start_time), toMin(r.end_time)))) {
    throw conflict("patient_double_booked", "This patient already has an appointment at that time");
  }
}
