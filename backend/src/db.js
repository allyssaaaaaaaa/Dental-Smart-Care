import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export function openDb(file) {
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
    created_by        INTEGER REFERENCES users(id),
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(full_name COLLATE NOCASE);

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
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, id);

  `);

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
        schedule.run(dentistId, weekday, "09:00", "12:00");
        schedule.run(dentistId, weekday, "13:00", "17:00");
      }
    }
  }

  db.prepare("UPDATE users SET active = 0 WHERE role IN ('clerk', 'dentist')").run();
  db.prepare(
    "UPDATE dentists SET active = 0 WHERE user_id IN (SELECT id FROM users WHERE role IN ('clerk', 'dentist'))",
  ).run();
}
