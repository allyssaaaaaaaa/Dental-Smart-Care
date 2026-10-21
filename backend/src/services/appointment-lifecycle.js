import { tx } from "../db.js";

const NO_SHOW_GRACE_MS = 24 * 60 * 60 * 1000;

function clinicDateTime(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

export function markOverdueAppointmentsNoShow({ db, hub, config }) {
  const now = config.clock();
  const cutoff = clinicDateTime(new Date(now.getTime() - NO_SHOW_GRACE_MS), config.clinicTz);
  const updatedAt = now.toISOString().replace("T", " ").slice(0, 19);
  const rows = tx(db, () => {
    const overdue = db.prepare(
      `SELECT id, reference, patient_id, dentist_id, date, start_time
       FROM appointments
       WHERE status = 'confirmed' AND datetime(date || ' ' || end_time) <= datetime(?)`,
    ).all(cutoff);
    if (overdue.length) {
      const update = db.prepare(
        `UPDATE appointments
         SET status = 'no_show', status_reason = ?, updated_at = ?
         WHERE id = ? AND status = 'confirmed'`,
      );
      for (const appointment of overdue) {
        update.run("Automatically marked no-show 24 hours after the appointment ended.", updatedAt, appointment.id);
      }
    }
    return overdue;
  });

  for (const appointment of rows) {
    const payload = {
      id: appointment.id,
      reference: appointment.reference,
      status: "no_show",
      date: appointment.date,
      startTime: appointment.start_time,
    };
    const patientUserId = db.prepare("SELECT user_id FROM patients WHERE id = ?").get(appointment.patient_id)?.user_id;
    const dentistUserId = db.prepare("SELECT user_id FROM dentists WHERE id = ?").get(appointment.dentist_id)?.user_id;
    if (patientUserId) hub.toUser(patientUserId, "appointment.updated", payload);
    if (dentistUserId) hub.toUser(dentistUserId, "appointment.updated", payload);
    hub.toRoles(["clerk", "admin"], "appointment.updated", payload);
  }
  return rows.length;
}
