import { forbidden, notFound } from "../lib/errors.js";
import { ageFrom, clinicNow, iso } from "../lib/time.js";

export const patientOfUser = (db, userId) => db.prepare("SELECT * FROM patients WHERE user_id = ?").get(userId);
export const dentistOfUser = (db, userId) => db.prepare("SELECT * FROM dentists WHERE user_id = ?").get(userId);

export function requirePatientProfile(db, user) {
  const p = patientOfUser(db, user.id);
  if (!p) throw forbidden("No patient profile is linked to this account");
  return p;
}
export function requireDentistProfile(db, user) {
  const d = dentistOfUser(db, user.id);
  if (!d) throw forbidden("No dentist profile is linked to this account");
  return d;
}
export function getPatientOrThrow(db, id) {
  const p = db.prepare("SELECT * FROM patients WHERE id = ?").get(id);
  if (!p) throw notFound("Patient");
  return p;
}

export function nextPatientCode(db, patientId) {
  return `SC-${String(10000 + patientId).padStart(5, "0")}`;
}

export function patientView(p, config) {
  return {
    id: p.id,
    code: p.code,
    fullName: p.full_name,
    birthDate: p.birth_date,
    age: ageFrom(p.birth_date, clinicNow(config).date),
    sex: p.sex,
    phone: p.phone,
    email: p.email,
    address: p.address,
    emergencyContact: p.emergency_contact,
    medicalNotes: p.medical_notes,
    hasAccount: Boolean(p.user_id),
    createdAt: iso(p.created_at),
  };
}

export const serviceView = (s) => ({
  id: s.id,
  name: s.name,
  category: s.category,
  description: s.description,
  pricePhp: s.price_php,
  durationMin: s.duration_min,
  prepGuidelines: s.prep_guidelines,
  active: Boolean(s.active),
});

export const APPT_SELECT = `
  SELECT a.*, p.full_name AS patient_name, p.code AS patient_code, p.phone AS patient_phone,
         du.full_name AS dentist_name, d.specialty AS dentist_specialty,
         s.name AS service_name, s.price_php, s.duration_min
  FROM appointments a
  JOIN patients p  ON p.id = a.patient_id
  JOIN dentists d  ON d.id = a.dentist_id
  JOIN users du    ON du.id = d.user_id
  JOIN services s  ON s.id = a.service_id`;

export const appointmentView = (a) => ({
  id: a.id,
  reference: a.reference,
  status: a.status,
  source: a.source,
  date: a.date,
  startTime: a.start_time,
  endTime: a.end_time,
  notes: a.notes,
  statusReason: a.status_reason,
  patient: { id: a.patient_id, code: a.patient_code, fullName: a.patient_name, phone: a.patient_phone },
  dentist: { id: a.dentist_id, name: a.dentist_name, specialty: a.dentist_specialty },
  service: { id: a.service_id, name: a.service_name, pricePhp: a.price_php, durationMin: a.duration_min },
  createdAt: iso(a.created_at),
});

export function getAppointmentRow(db, id) {
  const row = db.prepare(`${APPT_SELECT} WHERE a.id = ?`).get(id);
  if (!row) throw notFound("Appointment");
  return row;
}
