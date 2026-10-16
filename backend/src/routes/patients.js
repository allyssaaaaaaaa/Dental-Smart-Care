import { created, requireRole } from "../lib/router.js";
import { parse, parseQuery } from "../lib/validate.js";
import { getPatientOrThrow, nextPatientCode, patientOfUser, patientView, requirePatientProfile } from "../services/lookup.js";

const schema = (required) => ({
  fullName: { type: "string", required, min: 2, max: 120 },
  birthDate: { type: "birthDate", required, nullable: !required },
  sex: { type: "enum", values: ["female", "male", "other"], required },
  phone: { type: "phone", required },
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

// Business rule: ONLY the Clerk can create, search, and update patient profiles.
export default function register(router) {
  router.get("/api/patients/me", requireRole("patient"), (ctx) => patientView(requirePatientProfile(ctx.db, ctx.user), ctx.config));

  router.get("/api/patients", requireRole("clerk", "admin"), (ctx) => {
    const q = parseQuery(ctx.query, {
      q: { type: "string", max: 100 },
      page: { type: "int", min: 1, default: 1 },
      pageSize: { type: "int", min: 1, max: 100, default: 20 },
    });
    const like = `%${q.q ?? ""}%`;
    const where = q.q ? "WHERE full_name LIKE ? OR code LIKE ? OR phone LIKE ? OR email LIKE ?" : "";
    const args = q.q ? [like, like, like, like] : [];
    const total = ctx.db.prepare(`SELECT COUNT(*) AS n FROM patients ${where}`).get(...args).n;
    const rows = ctx.db.prepare(`SELECT * FROM patients ${where} ORDER BY full_name COLLATE NOCASE LIMIT ? OFFSET ?`)
      .all(...args, q.pageSize, (q.page - 1) * q.pageSize);
    return { items: rows.map((p) => patientView(p, ctx.config)), total, page: q.page, pageSize: q.pageSize };
  });

  router.post("/api/patients", requireRole("clerk", "admin"), (ctx) => {
    const data = parse(ctx.body, schema(true));
    return created(patientView(createPatient(ctx.db, ctx.config, data, ctx.user.id), ctx.config));
  });

  router.get("/api/patients/:id", requireRole("clerk", "admin"), (ctx) => patientView(getPatientOrThrow(ctx.db, ctx.params.id), ctx.config));

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
}
export { patientOfUser };
