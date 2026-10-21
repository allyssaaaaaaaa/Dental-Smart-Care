import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { PostgresDatabase } from "./postgres-db.js";

export function openDb(file, supabaseDbUrl = "") {
  if (supabaseDbUrl) return new PostgresDatabase(supabaseDbUrl);
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

/** Run fn inside an immediate transaction (rolls back on throw). */
export function tx(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw err;
  }
}

function migrate(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    role          TEXT NOT NULL CHECK (role IN ('patient','clerk','dentist','admin')),
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    full_name     TEXT NOT NULL,
    phone         TEXT,
    is_demo       INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Patient profiles. Created by the patient (portal sign-up) or by the clerk (walk-in / Messenger intake).
  CREATE TABLE IF NOT EXISTS patients (
    id                INTEGER PRIMARY KEY,
    code              TEXT UNIQUE,                        -- SC-98214
    user_id           INTEGER UNIQUE REFERENCES users(id),
    full_name         TEXT NOT NULL,
    birth_date        TEXT,
    sex               TEXT CHECK (sex IN ('female','male','other')),
    phone             TEXT,
    email             TEXT,
    address           TEXT,
    emergency_contact TEXT,
    medical_notes     TEXT,
    dentist_notes     TEXT,
    is_demo           INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
    created_by        INTEGER REFERENCES users(id),
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(full_name COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS dentist_patient_notes (
    id          INTEGER PRIMARY KEY,
    patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    created_by  INTEGER NOT NULL REFERENCES users(id),
    body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_dentist_notes_patient ON dentist_patient_notes(patient_id, created_at DESC, id DESC);

  CREATE TABLE IF NOT EXISTS services (
    id               INTEGER PRIMARY KEY,
    name             TEXT NOT NULL UNIQUE,
    category         TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    price_php        INTEGER NOT NULL CHECK (price_php >= 0),
    duration_min     INTEGER NOT NULL CHECK (duration_min > 0),
    prep_guidelines  TEXT NOT NULL DEFAULT '',
    active           INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS dentists (
    id        INTEGER PRIMARY KEY,
    user_id   INTEGER NOT NULL UNIQUE REFERENCES users(id),
    specialty TEXT NOT NULL DEFAULT 'General Dentistry',
    bio       TEXT NOT NULL DEFAULT '',
    status    TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','on_break','off_duty')),
    active    INTEGER NOT NULL DEFAULT 1
  );

  -- Weekly recurring hours. Several rows per weekday = split shifts (e.g. lunch break).
  CREATE TABLE IF NOT EXISTS dentist_schedules (
    id         INTEGER PRIMARY KEY,
    dentist_id INTEGER NOT NULL REFERENCES dentists(id) ON DELETE CASCADE,
    weekday    INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_time TEXT NOT NULL,
    end_time   TEXT NOT NULL,
    CHECK (start_time < end_time)
  );
  CREATE INDEX IF NOT EXISTS idx_sched_dentist ON dentist_schedules(dentist_id, weekday);

  CREATE TABLE IF NOT EXISTS dentist_time_off (
    id         INTEGER PRIMARY KEY,
    dentist_id INTEGER NOT NULL REFERENCES dentists(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    reason     TEXT,
    UNIQUE (dentist_id, date)
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id            INTEGER PRIMARY KEY,
    reference     TEXT NOT NULL UNIQUE,                   -- SC-7K2M9Q
    patient_id    INTEGER NOT NULL REFERENCES patients(id),
    dentist_id    INTEGER NOT NULL REFERENCES dentists(id),
    service_id    INTEGER NOT NULL REFERENCES services(id),
    date          TEXT NOT NULL,
    start_time    TEXT NOT NULL,
    end_time      TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','confirmed','declined','cancelled','completed','no_show')),
    source        TEXT NOT NULL DEFAULT 'online_portal'
                  CHECK (source IN ('online_portal','walk_in','messenger')),
    notes         TEXT,
    status_reason TEXT,
    created_by    INTEGER REFERENCES users(id),
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_appt_dentist_date ON appointments(dentist_id, date, status);
  CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments(patient_id, date);
  CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date);

  CREATE TABLE IF NOT EXISTS dentist_reviews (
    id             INTEGER PRIMARY KEY,
    appointment_id INTEGER NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
    patient_id     INTEGER NOT NULL REFERENCES patients(id),
    dentist_id     INTEGER NOT NULL REFERENCES dentists(id),
    rating         INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment        TEXT NOT NULL DEFAULT '' CHECK (length(comment) <= 1000),
    is_public      INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0,1)),
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_dentist_reviews_public ON dentist_reviews(dentist_id, is_public, created_at DESC);

  CREATE TABLE IF NOT EXISTS appointment_payments (
    id                    INTEGER PRIMARY KEY,
    appointment_id        INTEGER NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
    provider_checkout_id  TEXT NOT NULL UNIQUE,
    checkout_url          TEXT NOT NULL,
    amount_centavos       INTEGER NOT NULL CHECK (amount_centavos > 0),
    status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired','failed')),
    paid_at               TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payment_transactions (
    id                    INTEGER PRIMARY KEY,
    appointment_id        INTEGER NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
    provider_checkout_id  TEXT NOT NULL,
    provider_payment_id   TEXT UNIQUE,
    amount_paid_centavos  INTEGER NOT NULL CHECK (amount_paid_centavos > 0),
    status                TEXT NOT NULL CHECK (status IN ('paid')),
    paid_at               TEXT NOT NULL DEFAULT (datetime('now')),
    created_at            TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS appointment_counter_payments (
    id                    INTEGER PRIMARY KEY,
    appointment_id        INTEGER NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
    amount_centavos       INTEGER NOT NULL CHECK (amount_centavos > 0),
    received_by           INTEGER NOT NULL REFERENCES users(id),
    received_at           TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Temporary reservation while the patient fills in the booking form (countdown timer in the UI)
  CREATE TABLE IF NOT EXISTS slot_holds (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    dentist_id INTEGER NOT NULL REFERENCES dentists(id),
    date       TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time   TEXT NOT NULL,
    expires_at INTEGER NOT NULL                           -- epoch ms
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id              INTEGER PRIMARY KEY,
    patient_id      INTEGER NOT NULL REFERENCES patients(id),
    dentist_id      INTEGER NOT NULL REFERENCES dentists(id),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_message_at TEXT,
    UNIQUE (patient_id, dentist_id)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_user_id  INTEGER NOT NULL REFERENCES users(id),
    body            TEXT NOT NULL,
    read_at         TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, id);
  CREATE TABLE IF NOT EXISTS message_images (
    id              INTEGER PRIMARY KEY,
    conversation_id  INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    message_id       INTEGER NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    file_name        TEXT NOT NULL,
    content_type     TEXT NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
    byte_size        INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
    image_data       BLOB NOT NULL,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  `);

  const messageColumns = db.prepare("PRAGMA table_info(messages)").all();
  if (!messageColumns.some((column) => column.name === "updated_at")) {
    db.exec("ALTER TABLE messages ADD COLUMN updated_at TEXT");
  }

  const paidDepositMigration = "20261018_record_paid_deposit_transactions";
  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE id = ?").get(paidDepositMigration)) {
    tx(db, () => {
      db.prepare(
        `INSERT OR IGNORE INTO payment_transactions
         (appointment_id, provider_checkout_id, amount_paid_centavos, status, paid_at)
         SELECT appointment_id, provider_checkout_id, amount_centavos, 'paid', COALESCE(paid_at, datetime('now'))
         FROM appointment_payments WHERE status = 'paid'`,
      ).run();
      db.prepare(
        `UPDATE appointments SET status = 'confirmed', updated_at = datetime('now')
         WHERE source = 'online_portal' AND status = 'pending'
         AND id IN (SELECT appointment_id FROM appointment_payments WHERE status = 'paid')`,
      ).run();
      db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(paidDepositMigration);
    });
  }

  const userColumns = db.prepare("PRAGMA table_info(users)").all();
  if (!userColumns.some((column) => column.name === "is_demo")) {
    db.exec("ALTER TABLE users ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1))");
  }
  if (!userColumns.some((column) => column.name === "face_descriptor")) {
    db.exec("ALTER TABLE users ADD COLUMN face_descriptor TEXT");
  }
  const biometricColumns = db.prepare("PRAGMA table_info(users)").all();
  if (!biometricColumns.some((column) => column.name === "face_descriptor_consent_at")) {
    db.exec("ALTER TABLE users ADD COLUMN face_descriptor_consent_at TEXT");
  }
  const faceDescriptorMigration = "20261021_add_encrypted_face_descriptors_and_consent";
  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE id = ?").get(faceDescriptorMigration)) {
    db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(faceDescriptorMigration);
  }
  const demoAccountMigration = "20261018_mark_seeded_demo_accounts";
  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE id = ?").get(demoAccountMigration)) {
    db.prepare("UPDATE users SET is_demo = 1 WHERE email IN ('maria.santos@smartcare.test','admin@smartcare.test','clerk@smartcare.test','doc.petil@smartcare.test')").run();
    db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(demoAccountMigration);
  }

  const patientColumns = db.prepare("PRAGMA table_info(patients)").all();
  if (!patientColumns.some((column) => column.name === "is_demo")) {
    db.exec("ALTER TABLE patients ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1))");
  }
  const demoPatientMigration = "20261018_mark_seeded_demo_patient_profiles";
  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE id = ?").get(demoPatientMigration)) {
    db.prepare(
      `UPDATE patients SET is_demo = 1
       WHERE (code = 'SC-98214' AND full_name = 'Maria Santos')
          OR (code = 'SC-10001' AND full_name = 'Juan Dela Cruz')
          OR (code = 'SC-10002' AND full_name = 'Ana Reyes')
          OR user_id IN (SELECT id FROM users WHERE is_demo = 1)`,
    ).run();
    db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(demoPatientMigration);
  }
  if (!patientColumns.some((column) => column.name === "dentist_notes")) {
    db.exec("ALTER TABLE patients ADD COLUMN dentist_notes TEXT");
  }
  const dentistNotesMigration = "20261018_migrate_dentist_notes_to_entries";
  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE id = ?").get(dentistNotesMigration)) {
    const legacyNotes = db.prepare("SELECT id, dentist_notes, created_by FROM patients WHERE dentist_notes IS NOT NULL AND trim(dentist_notes) != ''").all();
    const fallbackAuthor = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get()?.id;
    const insertNote = db.prepare("INSERT INTO dentist_patient_notes (patient_id, created_by, body) VALUES (?,?,?)");
    for (const patient of legacyNotes) {
      const authorId = patient.created_by ?? fallbackAuthor;
      if (authorId) insertNote.run(patient.id, authorId, patient.dentist_notes);
    }
    db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(dentistNotesMigration);
  }

  const admin = db.prepare("SELECT id, full_name, phone FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1").get();
  if (admin && !db.prepare("SELECT 1 FROM dentists WHERE user_id = ?").get(admin.id)) {
    const legacyDentist = db.prepare(
      `SELECT d.id, u.full_name, u.phone
       FROM dentists d JOIN users u ON u.id = d.user_id
       WHERE d.active = 1 AND u.role = 'dentist'
       ORDER BY d.id LIMIT 1`,
    ).get();

    if (legacyDentist) {
      db.prepare("UPDATE dentists SET user_id = ? WHERE id = ?").run(admin.id, legacyDentist.id);
      if (admin.full_name === "Admin") {
        db.prepare("UPDATE users SET full_name = ?, phone = COALESCE(phone, ?) WHERE id = ?")
          .run(legacyDentist.full_name, legacyDentist.phone, admin.id);
      }
    } else {
      const dentistId = db.prepare("INSERT INTO dentists (user_id) VALUES (?)").run(admin.id).lastInsertRowid;
      const schedule = db.prepare(
        "INSERT INTO dentist_schedules (dentist_id, weekday, start_time, end_time) VALUES (?,?,?,?)",
      );
      for (let weekday = 1; weekday <= 5; weekday++) {
        schedule.run(dentistId, weekday, "08:00", "17:00");
      }
    }
  }

  const hourlyScheduleMigration = "20261018_hourly_appointments_8_to_5";
  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE id = ?").get(hourlyScheduleMigration)) {
    tx(db, () => {
      const workdays = db.prepare(
        "SELECT DISTINCT dentist_id, weekday FROM dentist_schedules ORDER BY dentist_id, weekday",
      ).all();
      db.prepare("DELETE FROM dentist_schedules").run();
      const schedule = db.prepare(
        "INSERT INTO dentist_schedules (dentist_id, weekday, start_time, end_time) VALUES (?,?,?,?)",
      );
      for (const { dentist_id, weekday } of workdays) {
        schedule.run(dentist_id, weekday, "08:00", "17:00");
      }
      db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(hourlyScheduleMigration);
    });
  }

  const hourlyAppointmentMigration = "20261018_one_hour_active_appointments";
  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE id = ?").get(hourlyAppointmentMigration)) {
    tx(db, () => {
      const futureAppointments = db.prepare(
        `SELECT id, start_time FROM appointments
         WHERE date >= date('now') AND status IN ('pending','confirmed')`,
      ).all();
      const updateAppointment = db.prepare("UPDATE appointments SET end_time = ? WHERE id = ?");
      for (const appointment of futureAppointments) {
        const [hour, minute] = appointment.start_time.split(":").map(Number);
        const endMinutes = hour * 60 + minute + 60;
        updateAppointment.run(
          `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`,
          appointment.id,
        );
      }
      db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(hourlyAppointmentMigration);
    });
  }

  db.prepare(
    `UPDATE users SET active = 0
     WHERE role = 'clerk'
        OR (role = 'dentist' AND NOT EXISTS (SELECT 1 FROM dentists WHERE dentists.user_id = users.id))`,
  ).run();
  db.prepare(
    "UPDATE dentists SET active = 0 WHERE user_id IN (SELECT id FROM users WHERE role = 'clerk')",
  ).run();
}
