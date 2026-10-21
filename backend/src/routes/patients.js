import { notFound } from "../lib/errors.js";
import { created, requireRole } from "../lib/router.js";
import { iso } from "../lib/time.js";
import { parse, parseQuery } from "../lib/validate.js";
import { getPatientOrThrow, nextPatientCode, patientOfUser, patientView, requirePatientProfile } from "../services/lookup.js";

const schema = (required) => ({
  fullName: { type: "string", required, min: 2, max: 120 },
  birthDate: { type: "birthDate", required, nullable: !required },
  sex: { type: "enum", values: ["female", "male", "other"], required },
  phone: { type: "phone" },
  email: { type: "email" },
  address: { type: "string", max: 300 },
  emergencyContact: { type: "string", max: 200 },
  medicalNotes: { type: "string", max: 2000 },
});

/** Insert a patient profile (used by clerk intake and walk-in check-in). */
export function createPatient(db, config, data, createdBy) {
  const r = db.prepare(
    `INSERT INTO patients (full_name, birth_date, sex, phone, email, address, emergency_contact, medical_notes, created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(data.fullName, data.birthDate ?? null, data.sex ?? null, data.phone ?? null, data.email ?? null, data.address ?? null,
    data.emergencyContact ?? null, data.medicalNotes ?? null, createdBy);
  db.prepare("UPDATE patients SET code = ? WHERE id = ?").run(nextPatientCode(db, Number(r.lastInsertRowid)), r.lastInsertRowid);
  return db.prepare("SELECT * FROM patients WHERE id = ?").get(r.lastInsertRowid);
}
export const patientSchema = schema;
const dentistNoteView = (note) => ({
  id: note.id,
  patientId: note.patient_id,
  createdBy: note.created_by,
  body: note.body,
  createdAt: iso(note.created_at),
  updatedAt: iso(note.updated_at),
});

// Business rule: ONLY the Clerk can create, search, and update patient profiles.
export default function register(router) {
  router.get("/api/patients/me", requireRole("patient"), (ctx) => patientView(requirePatientProfile(ctx.db, ctx.user), ctx.config));

  router.get("/api/patients", requireRole("clerk", "admin"), (ctx) => {
    const q = parseQuery(ctx.query, {
      q: { type: "string", max: 100 },
      page: { type: "int", min: 1, default: 1 },
      pageSize: { type: "int", min: 1, max: 100, default: 20 },
    });
    const filters = [];
    const args = [];
    if (ctx.user.role === "admin") filters.push("is_demo = 0");
    if (q.q) {
      filters.push("(full_name LIKE ? OR code LIKE ? OR phone LIKE ? OR email LIKE ?)");
      args.push(...Array(4).fill(`%${q.q}%`));
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const total = ctx.db.prepare(`SELECT COUNT(*) AS n FROM patients ${where}`).get(...args).n;
    const rows = ctx.db.prepare(`SELECT * FROM patients ${where} ORDER BY full_name COLLATE NOCASE LIMIT ? OFFSET ?`)
      .all(...args, q.pageSize, (q.page - 1) * q.pageSize);
    return { items: rows.map((p) => patientView(p, ctx.config)), total, page: q.page, pageSize: q.pageSize };
  });

  router.post("/api/patients", requireRole("clerk", "admin"), (ctx) => {
    const data = parse(ctx.body, schema(true));
    return created(patientView(createPatient(ctx.db, ctx.config, data, ctx.user.id), ctx.config));
  });

  router.get("/api/patients/:id", requireRole("clerk", "admin"), (ctx) => {
    const patient = getPatientOrThrow(ctx.db, ctx.params.id);
    if (ctx.user.role === "admin" && patient.is_demo) throw notFound("Patient");
    return patientView(patient, ctx.config);
  });

  router.patch("/api/patients/:id", requireRole("clerk", "admin"), (ctx) => {
    const cur = getPatientOrThrow(ctx.db, ctx.params.id);
    const d = parse(ctx.body, schema(false));
    ctx.db.prepare(
      `UPDATE patients SET full_name=?, birth_date=?, sex=?, phone=?, email=?, address=?, emergency_contact=?, medical_notes=?,
       updated_at=datetime('now') WHERE id=?`,
    ).run(d.fullName ?? cur.full_name, d.birthDate === undefined ? cur.birth_date : d.birthDate, d.sex ?? cur.sex, d.phone ?? cur.phone,
      d.email ?? cur.email, d.address ?? cur.address, d.emergencyContact ?? cur.emergency_contact, d.medicalNotes ?? cur.medical_notes, cur.id);
    return patientView(getPatientOrThrow(ctx.db, cur.id), ctx.config);
  });

  router.get("/api/patients/:id/dentist-notes", requireRole("admin"), (ctx) => {
    const patient = getPatientOrThrow(ctx.db, ctx.params.id);
    return { patientId: patient.id, notes: patient.dentist_notes ?? "" };
  });

  router.patch("/api/patients/:id/dentist-notes", requireRole("admin"), (ctx) => {
    const patient = getPatientOrThrow(ctx.db, ctx.params.id);
    const { notes } = parse(ctx.body, {
      notes: { type: "string", max: 5000, required: true },
    });
    ctx.db.prepare("UPDATE patients SET dentist_notes = ?, updated_at = datetime('now') WHERE id = ?")
      .run(notes, patient.id);
    return { patientId: patient.id, notes };
  });

  router.get("/api/patients/:id/dentist-notes/entries", requireRole("admin"), (ctx) => {
    const patient = getPatientOrThrow(ctx.db, ctx.params.id);
    const items = ctx.db.prepare(
      `SELECT id, patient_id, created_by, body, created_at, updated_at
       FROM dentist_patient_notes WHERE patient_id = ? ORDER BY created_at DESC, id DESC`,
    ).all(patient.id);
    return { patientId: patient.id, items: items.map(dentistNoteView) };
  });

  router.post("/api/patients/:id/dentist-notes/entries", requireRole("admin"), (ctx) => {
    const patient = getPatientOrThrow(ctx.db, ctx.params.id);
    const { body } = parse(ctx.body, {
      body: { type: "string", required: true, min: 1, max: 5000 },
    });
    const result = ctx.db.prepare(
      "INSERT INTO dentist_patient_notes (patient_id, created_by, body) VALUES (?,?,?)",
    ).run(patient.id, ctx.user.id, body);
    const note = ctx.db.prepare(
      "SELECT id, patient_id, created_by, body, created_at, updated_at FROM dentist_patient_notes WHERE id = ?",
    ).get(result.lastInsertRowid);
    ctx.hub.toRoles(["admin"], "dentist.note.updated", { patientId: patient.id, action: "created", noteId: note.id });
    return created(dentistNoteView(note));
  });

  router.patch("/api/patients/:id/dentist-notes/entries/:noteId", requireRole("admin"), (ctx) => {
    const patient = getPatientOrThrow(ctx.db, ctx.params.id);
    const { noteId } = parse({ noteId: ctx.params.noteId }, { noteId: { type: "int", min: 1, required: true } });
    const current = ctx.db.prepare(
      "SELECT id FROM dentist_patient_notes WHERE id = ? AND patient_id = ?",
    ).get(noteId, patient.id);
    if (!current) throw notFound("Dentist note");
    const { body } = parse(ctx.body, {
      body: { type: "string", required: true, min: 1, max: 5000 },
    });
    ctx.db.prepare("UPDATE dentist_patient_notes SET body = ?, updated_at = datetime('now') WHERE id = ?")
      .run(body, noteId);
    const note = ctx.db.prepare(
      "SELECT id, patient_id, created_by, body, created_at, updated_at FROM dentist_patient_notes WHERE id = ?",
    ).get(noteId);
    ctx.hub.toRoles(["admin"], "dentist.note.updated", { patientId: patient.id, action: "updated", noteId });
    return dentistNoteView(note);
  });

  router.delete("/api/patients/:id/dentist-notes/entries/:noteId", requireRole("admin"), (ctx) => {
    const patient = getPatientOrThrow(ctx.db, ctx.params.id);
    const { noteId } = parse({ noteId: ctx.params.noteId }, { noteId: { type: "int", min: 1, required: true } });
    const result = ctx.db.prepare(
      "DELETE FROM dentist_patient_notes WHERE id = ? AND patient_id = ?",
    ).run(noteId, patient.id);
    if (!result.changes) return { deleted: false };
    ctx.hub.toRoles(["admin"], "dentist.note.updated", { patientId: patient.id, action: "deleted", noteId });
    return { deleted: true };
  });
}
export { patientOfUser };
