import { tx } from "./db.js";
import { hashPassword } from "./lib/security.js";
import { addDays, clinicNow, weekdayOf } from "./lib/time.js";

export const DEMO_PASSWORD = "SmartCare123!";

const SERVICES = [
  ["Consultation & Check-up", "General", "Oral exam and treatment planning. Bring previous dental records or x-rays if you have them.", 500, 30, "Bring a valid ID and a list of medications you take. Brush your teeth before the visit."],
  ["Oral Prophylaxis (Cleaning)", "Preventive", "Professional scaling and polishing to remove plaque and tartar.", 800, 30, "No special preparation. Avoid heavily colored food and drinks 2 hours before."],
  ["Dental X-ray", "Diagnostic", "Periapical or panoramic x-ray for diagnosis.", 400, 30, "Tell the dentist if you are or might be pregnant. Remove earrings or necklaces."],
  ["Composite (Tooth-colored) Filling", "Restorative", "Repair of cavities using tooth-colored resin.", 1200, 60, "Eat beforehand; the area may be numb for 2-3 hours after. Avoid chewing on the treated side until the numbness fades."],
  ["Tooth Extraction (Simple)", "Surgery", "Removal of a visible, non-impacted tooth under local anesthesia.", 1500, 60, "Eat a light meal first. Tell us about blood thinners, diabetes or heart conditions. Arrange a ride home if you feel anxious."],
  ["Root Canal Treatment", "Endodontics", "Removal of infected pulp to save the tooth (per session).", 8000, 90, "Take any prescribed antibiotics as directed. Eat beforehand. Expect 1-3 sessions."],
  ["Teeth Whitening", "Cosmetic", "In-clinic whitening for a brighter smile.", 5000, 60, "Get a cleaning first. Avoid smoking, coffee and tea for 48 hours after the procedure."],
  ["Braces Adjustment", "Orthodontics", "Monthly wire change and tightening for patients with braces.", 1500, 30, "Brush and floss thoroughly before arriving. Bring your retainer case."],
];

function insertUser(db, role, email, fullName, phone) {
  return Number(db.prepare("INSERT INTO users (role, email, password_hash, full_name, phone) VALUES (?,?,?,?,?)")
    .run(role, email, hashPassword(DEMO_PASSWORD), fullName, phone).lastInsertRowid);
}

export function seedIfEmpty(app) {
  const { db, config } = app;
  if (db.prepare("SELECT COUNT(*) AS n FROM users").get().n > 0) return false;
  const today = clinicNow(config).date;

  tx(db, () => {
    const adminUser = insertUser(db, "admin", "admin@smartcare.test", "Dr. Elena Santos, DMD", "+639170000002");
    const clerkUser = insertUser(db, "clerk", "clerk@smartcare.test", "Ally Cy", "+639170000001");

    // ----- dentists + weekly hours -----
    const mkDentist = (email, name, specialty, bio, hours, userId) => {
      const uid = userId ?? insertUser(db, "dentist", email, name, "+639170000002");
      const id = Number(db.prepare("INSERT INTO dentists (user_id, specialty, bio) VALUES (?,?,?)").run(uid, specialty, bio).lastInsertRowid);
      for (const [wd, s, e] of hours) db.prepare("INSERT INTO dentist_schedules (dentist_id, weekday, start_time, end_time) VALUES (?,?,?,?)").run(id, wd, s, e);
      return { id, uid };
    };
    const hoursFor = (days, blocks) => days.flatMap((d) => blocks.map(([s, e]) => [d, s, e]));
    const elena = mkDentist("admin@smartcare.test", "Dr. Elena Santos, DMD", "General Dentistry",
      "Family and preventive dentistry with 12 years of experience.",
      [...hoursFor([1, 2, 3, 4, 5], [["09:00", "12:00"], ["13:00", "17:00"]]), [6, "09:00", "12:00"]], adminUser);
    const marco = mkDentist("marco.reyes@smartcare.test", "Dr. Marco Reyes, DMD", "Orthodontics",
      "Braces, aligners and smile design.", hoursFor([2, 3, 4, 5, 6], [["10:00", "12:00"], ["13:00", "18:00"]]));

    // ----- services -----
    for (const [name, cat, desc, price, dur, prep] of SERVICES) {
      db.prepare("INSERT INTO services (name, category, description, price_php, duration_min, prep_guidelines) VALUES (?,?,?,?,?,?)").run(name, cat, desc, price, dur, prep);
    }
    const svc = Object.fromEntries(db.prepare("SELECT id, name FROM services").all().map((s) => [s.name, s.id]));

    // ----- patients -----
    const mkPatient = (code, name, birth, sex, phone, userId, email) => Number(db.prepare(
      "INSERT INTO patients (code, user_id, full_name, birth_date, sex, phone, email, created_by) VALUES (?,?,?,?,?,?,?,?)",
    ).run(code, userId, name, birth, sex, phone, email, userId ?? clerkUser).lastInsertRowid);
    const mariaUser = insertUser(db, "patient", "maria.santos@smartcare.test", "Maria Santos", "+639171234567");
    const maria = mkPatient("SC-98214", "Maria Santos", "1992-05-14", "female", "+639171234567", mariaUser, "maria.santos@smartcare.test");
    const juan = mkPatient("SC-10001", "Juan Dela Cruz", "1985-11-02", "male", "+639181112222", null, null);
    const ana = mkPatient("SC-10002", "Ana Reyes", "2001-03-27", "female", "+639193334444", null, null);

    // ----- sample appointments (relative to today so the demo always has data) -----
    const nextWorkday = (from, offset = 1) => {
      let d = from; let left = offset;
      while (left > 0) { d = addDays(d, 1); if (weekdayOf(d) !== 0) left -= 1; }
      return d;
    };
    let ref = 0;
    const appt = (patient, dentist, service, date, start, end, status, source = "online_portal") => {
      ref += 1;
      db.prepare("INSERT INTO appointments (reference, patient_id, dentist_id, service_id, date, start_time, end_time, status, source, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(`SC-DEMO${String(ref).padStart(2, "0")}`, patient, dentist, service, date, start, end, status, source, clerkUser);
    };
    appt(maria, elena.id, svc["Oral Prophylaxis (Cleaning)"], nextWorkday(today, 1), "10:00", "10:30", "confirmed");
    appt(maria, elena.id, svc["Composite (Tooth-colored) Filling"], nextWorkday(today, 3), "14:00", "15:00", "pending");
    appt(juan, elena.id, svc["Consultation & Check-up"], nextWorkday(today, 1), "09:00", "09:30", "pending", "messenger");
    appt(ana, marco.id, svc["Braces Adjustment"], nextWorkday(today, 2), "14:00", "14:30", "confirmed", "walk_in");
    // history
    appt(maria, elena.id, svc["Oral Prophylaxis (Cleaning)"], addDays(today, -60), "09:00", "09:30", "completed");
    appt(maria, elena.id, svc["Dental X-ray"], addDays(today, -60), "09:30", "10:00", "completed");
    appt(juan, elena.id, svc["Tooth Extraction (Simple)"], addDays(today, -21), "13:00", "14:00", "completed", "walk_in");
    appt(ana, marco.id, svc["Braces Adjustment"], addDays(today, -28), "14:00", "14:30", "completed");
    appt(juan, elena.id, svc["Teeth Whitening"], addDays(today, -14), "10:00", "11:00", "no_show", "messenger");
    appt(ana, marco.id, svc["Consultation & Check-up"], addDays(today, -9), "11:00", "11:30", "cancelled");

    // ----- a starter chat thread -----
    const conv = Number(db.prepare("INSERT INTO conversations (patient_id, dentist_id, last_message_at) VALUES (?,?,datetime('now'))").run(maria, elena.id).lastInsertRowid);
    const msg = (sender, body) => db.prepare("INSERT INTO messages (conversation_id, sender_user_id, body) VALUES (?,?,?)").run(conv, sender, body);
    msg(mariaUser, "Hello Doc! Do I need to fast before my cleaning appointment?");
    msg(elena.uid, "Hi Maria! No fasting needed. Just brush your teeth beforehand and see you soon.");
  });
  return true;
}
