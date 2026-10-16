import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { addDays, clinicNow, weekdayOf } from "../src/lib/time.js";
import { DEMO_PASSWORD } from "../src/seed.js";

let srv, base;
const tzCfg = { clinicTz: "Asia/Manila", clock: () => new Date() };

async function api(method, path, { token, body, headers } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}
const demo = async (role) => (await api("POST", "/api/auth/demo-login", { body: { role } })).body.token;
const errCode = (r) => r.body?.error?.code;

// a Tue-Fri at least a week ahead: both dentists work these days
function futureWorkday(minAhead = 7) {
  let d = addDays(clinicNow(tzCfg).date, minAhead);
  while (![2, 3, 4, 5].includes(weekdayOf(d))) d = addDays(d, 1);
  return d;
}

before(async () => {
  srv = createApp({ dbPath: ":memory:", seedOnStart: true, demoMode: true, jwtSecret: "t".repeat(40), port: 0 });
  await new Promise((r) => srv.server.listen(0, r));
  base = `http://localhost:${srv.server.address().port}`;
});
after(() => srv.close());

describe("auth & access control", () => {
  test("health + unauthenticated access", async () => {
    assert.equal((await api("GET", "/api/health")).status, 200);
    assert.equal((await api("GET", "/api/auth/me")).status, 401);
    assert.equal((await api("GET", "/api/appointments")).status, 401);
    assert.equal((await api("GET", "/api/nope")).status, 404);
    assert.equal((await api("DELETE", "/api/health")).status, 405);
  });

  test("register validates, creates patient profile, blocks duplicates", async () => {
    const bad = await api("POST", "/api/auth/register", { body: { fullName: "A", email: "nope", password: "short", phone: "123" } });
    assert.equal(bad.status, 422);
    assert.ok(bad.body.error.details.email && bad.body.error.details.password && bad.body.error.details.phone);

    const ok = await api("POST", "/api/auth/register", { body: { fullName: "Pedro Penduko", email: "Pedro@Example.com", password: "Passw0rdOK", phone: "0917 555 1234" } });
    assert.equal(ok.status, 201);
    assert.match(ok.body.user.patientCode, /^SC-\d{5}$/);
    assert.match(ok.headers.get("set-cookie"), /HttpOnly/);

    const dup = await api("POST", "/api/auth/register", { body: { fullName: "Pedro Two", email: "pedro@example.com", password: "Passw0rdOK", phone: "0917 555 1234" } });
    assert.equal(dup.status, 409);

    const login = await api("POST", "/api/auth/login", { body: { email: "pedro@example.com", password: "Passw0rdOK" } });
    assert.equal(login.status, 200);
    const me = await api("GET", "/api/auth/me", { token: login.body.token });
    assert.equal(me.body.user.role, "patient");
  });

  test("patient and dentist-administrator accounts use password login", async () => {
    const login = await api("POST", "/api/auth/login", {
      body: { email: "admin@smartcare.test", password: DEMO_PASSWORD },
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.role, "admin");
    assert.ok(login.body.user.dentistId);
    assert.equal((await api("GET", "/api/dentists/me", { token: login.body.token })).status, 200);

    for (const email of ["clerk@smartcare.test", "marco.reyes@smartcare.test"]) {
      const staffLogin = await api("POST", "/api/auth/login", {
        body: { email, password: DEMO_PASSWORD },
      });
      assert.equal(staffLogin.status, 401);
    }
  });

  test("wrong password -> 401, repeated failures -> 429", async () => {
    const attempt = () => api("POST", "/api/auth/login", { body: { email: "ghost@example.com", password: "whatever1" } });
    assert.equal((await attempt()).status, 401);
    let last; for (let i = 0; i < 11; i++) last = await attempt();
    assert.equal(last.status, 429);
  });

  test("tampered / forged tokens are rejected", async () => {
    const t = await demo("patient");
    const [h, p, s] = t.split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: 1, role: "admin", exp: 9999999999 })).toString("base64url")}.${s}`;
    assert.equal((await api("GET", "/api/admin/analytics", { token: forged })).status, 401);
    assert.equal((await api("GET", "/api/admin/analytics", { token: t })).status, 403);
  });

  test("admin manages patient profiles; patients and legacy dentist accounts cannot", async () => {
    for (const role of ["patient", "dentist"]) {
      const tk = await demo(role);
      assert.equal((await api("GET", "/api/patients", { token: tk })).status, 403, `${role} list`);
      assert.equal((await api("POST", "/api/patients", { token: tk, body: {} })).status, 403, `${role} create`);
    }
    const admin = await demo("admin");
    assert.equal((await api("GET", "/api/patients?q=maria", { token: admin })).status, 200);
    const clerk = await demo("clerk");
    const list = await api("GET", "/api/patients?q=maria", { token: clerk });
    assert.equal(list.status, 200);
    assert.equal(list.body.items[0].code, "SC-98214");
  });
});

describe("legacy account migration", () => {
  test("disables staff logins and preserves patient and appointment records", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "smartcare-auth-"));
    let db;
    try {
      const dbPath = path.join(directory, "legacy.db");
      db = openDb(dbPath);
      const addUser = (role, email, name) => Number(db.prepare(
        "INSERT INTO users (role, email, password_hash, full_name) VALUES (?,?,?,?)",
      ).run(role, email, "legacy-hash", name).lastInsertRowid);
      const adminId = addUser("admin", "admin@example.test", "Admin");
      const dentistId = addUser("dentist", "dentist@example.test", "Dr. Clinic");
      const otherDentistId = addUser("dentist", "other@example.test", "Dr. Former");
      const clerkId = addUser("clerk", "clerk@example.test", "Front Desk");
      const firstProfile = Number(db.prepare("INSERT INTO dentists (user_id) VALUES (?)").run(dentistId).lastInsertRowid);
      db.prepare("INSERT INTO dentists (user_id) VALUES (?)").run(otherDentistId);
      const patientId = Number(db.prepare("INSERT INTO patients (full_name) VALUES ('Existing Patient')").run().lastInsertRowid);
      const serviceId = Number(db.prepare(
        "INSERT INTO services (name, category, price_php, duration_min) VALUES ('Checkup', 'General', 500, 30)",
      ).run().lastInsertRowid);
      db.prepare(
        "INSERT INTO appointments (reference, patient_id, dentist_id, service_id, date, start_time, end_time) VALUES ('SC-KEEP01', ?, ?, ?, '2026-11-01', '09:00', '09:30')",
      ).run(patientId, firstProfile, serviceId);
      db.close();

      db = openDb(dbPath);
      assert.equal(db.prepare("SELECT id FROM dentists WHERE user_id = ?").get(adminId).id, firstProfile);
      assert.equal(db.prepare("SELECT active FROM users WHERE id = ?").get(dentistId).active, 0);
      assert.equal(db.prepare("SELECT active FROM users WHERE id = ?").get(otherDentistId).active, 0);
      assert.equal(db.prepare("SELECT active FROM users WHERE id = ?").get(clerkId).active, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM patients").get().n, 1);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM appointments").get().n, 1);
      assert.equal(db.prepare("SELECT active FROM dentists WHERE user_id = ?").get(adminId).active, 1);
    } finally {
      db?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("service catalog & dentists", () => {
  test("public catalog with prices, duration and prep guidelines", async () => {
    const r = await api("GET", "/api/services");
    assert.equal(r.status, 200);
    assert.equal(r.body.items.length, 8);
    assert.ok(r.body.items[0].prepGuidelines && r.body.items[0].durationMin && r.body.items[0].pricePhp >= 0);
    assert.ok(r.body.categories.includes("Preventive"));
  });
  test("admin manages services; others cannot", async () => {
    const body = { name: "Dental Sealant", category: "Preventive", pricePhp: 700, durationMin: 30 };
    assert.equal((await api("POST", "/api/services", { token: await demo("patient"), body })).status, 403);
    const made = await api("POST", "/api/services", { token: await demo("admin"), body });
    assert.equal(made.status, 201);
    await api("DELETE", `/api/services/${made.body.id}`, { token: await demo("admin") });
    assert.equal((await api("GET", `/api/services/${made.body.id}`)).status, 404);
  });
  test("dentist directory is public", async () => {
    const r = await api("GET", "/api/dentists");
    assert.equal(r.body.items.length, 2);
    assert.equal(r.body.items[0].email, undefined); // contact details not exposed publicly
  });
});

describe("booking flow", () => {
  const date = futureWorkday();
  let maria, other, svc30, svc60, elena, holdId, apptId;

  before(async () => {
    maria = await demo("patient");
    other = (await api("POST", "/api/auth/register", { body: { fullName: "Other Patient", email: "other@example.com", password: "Passw0rdOK", phone: "09175550000" } })).body.token;
    const services = (await api("GET", "/api/services")).body.items;
    svc30 = services.find((s) => s.name.startsWith("Oral Prophylaxis")).id;
    svc60 = services.find((s) => s.name.startsWith("Composite")).id;
    elena = (await api("GET", "/api/dentists")).body.items.find((d) => d.name.includes("Elena")).id;
  });

  test("availability shows slots honoring the dentist's weekly hours", async () => {
    const r = await api("GET", `/api/dentists/${elena}/availability?date=${date}&serviceId=${svc30}`);
    assert.equal(r.status, 200);
    const times = r.body.slots.map((s) => s.startTime);
    assert.ok(times.includes("09:00") && times.includes("16:30"));
    assert.ok(!times.includes("12:00") && !times.includes("12:30"), "lunch break must not be offered");
    assert.ok(r.body.slots.every((s) => s.available));
  });

  test("a 60-min service does not run into the lunch break", async () => {
    const r = await api("GET", `/api/dentists/${elena}/availability?date=${date}&serviceId=${svc60}`);
    const times = r.body.slots.map((s) => s.startTime);
    assert.ok(times.includes("11:00") && !times.includes("11:30"));
  });

  test("slot hold blocks other patients but not the holder", async () => {
    const h = await api("POST", "/api/slot-holds", { token: maria, body: { serviceId: svc30, dentistId: elena, date, startTime: "10:00" } });
    assert.equal(h.status, 201);
    holdId = h.body.id;
    const theirView = await api("GET", `/api/dentists/${elena}/availability?date=${date}&serviceId=${svc30}`, { token: other });
    assert.equal(theirView.body.slots.find((s) => s.startTime === "10:00").available, false);
    const myView = await api("GET", `/api/dentists/${elena}/availability?date=${date}&serviceId=${svc30}`, { token: maria });
    assert.equal(myView.body.slots.find((s) => s.startTime === "10:00").available, true);
    const steal = await api("POST", "/api/appointments", { token: other, body: { serviceId: svc30, dentistId: elena, date, startTime: "10:00" } });
    assert.equal(steal.status, 409);
    assert.equal(errCode(steal), "slot_unavailable");
  });

  test("patient books with the hold -> pending; slot is now taken", async () => {
    const r = await api("POST", "/api/appointments", { token: maria, body: { serviceId: svc30, dentistId: elena, date, startTime: "10:00", holdId, notes: "Sensitive tooth" } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.status, "pending");
    assert.equal(r.body.source, "online_portal");
    assert.match(r.body.reference, /^SC-[A-Z2-9]{6}$/);
    assert.equal(r.body.endTime, "10:30");
    apptId = r.body.id;
    const again = await api("POST", "/api/appointments", { token: other, body: { serviceId: svc30, dentistId: elena, date, startTime: "10:00" } });
    assert.equal(again.status, 409);
  });

  test("overlapping longer procedure is rejected (no double-booking)", async () => {
    // 09:30-10:30 would overlap Maria's 10:00-10:30
    const r = await api("POST", "/api/appointments", { token: other, body: { serviceId: svc60, dentistId: elena, date, startTime: "09:30" } });
    assert.equal(r.status, 409);
    const av = await api("GET", `/api/dentists/${elena}/availability?date=${date}&serviceId=${svc60}`);
    assert.equal(av.body.slots.find((s) => s.startTime === "09:30").available, false);
    assert.equal(av.body.slots.find((s) => s.startTime === "10:30").available, true);
  });

  test("a patient cannot be double-booked with another dentist at the same time", async () => {
    const marco = (await api("GET", "/api/dentists")).body.items.find((d) => d.name.includes("Marco")).id;
    const r = await api("POST", "/api/appointments", { token: maria, body: { serviceId: svc30, dentistId: marco, date, startTime: "10:00" } });
    assert.equal(r.status, 409);
    assert.equal(errCode(r), "patient_double_booked");
  });

  test("rejects past dates, off-hours and bad input", async () => {
    const past = await api("POST", "/api/appointments", { token: maria, body: { serviceId: svc30, dentistId: elena, date: "2020-01-07", startTime: "10:00" } });
    assert.equal(past.status, 422);
    const night = await api("POST", "/api/appointments", { token: maria, body: { serviceId: svc30, dentistId: elena, date, startTime: "20:00" } });
    assert.equal(night.status, 422);
    const junk = await api("POST", "/api/appointments", { token: maria, body: { serviceId: "x", date: "tomorrow" } });
    assert.equal(junk.status, 422);
  });

  test("privacy: patients only see their own appointments", async () => {
    assert.equal((await api("GET", `/api/appointments/${apptId}`, { token: other })).status, 404);
    const mine = await api("GET", "/api/appointments?scope=upcoming", { token: maria });
    assert.ok(mine.body.items.length >= 3 && mine.body.items.every((a) => a.patient.code === "SC-98214"));
    const theirs = await api("GET", "/api/appointments", { token: other });
    assert.equal(theirs.body.total, 0);
  });

  test("dentist confirms; patient cannot self-confirm; invalid transitions blocked", async () => {
    assert.equal((await api("PATCH", `/api/appointments/${apptId}/status`, { token: maria, body: { status: "confirmed" } })).status, 403);
    const dentist = await demo("admin");
    const ok = await api("PATCH", `/api/appointments/${apptId}/status`, { token: dentist, body: { status: "confirmed" } });
    assert.equal(ok.body.status, "confirmed");
    const bad = await api("PATCH", `/api/appointments/${apptId}/status`, { token: dentist, body: { status: "declined" } });
    assert.equal(bad.status, 409);
    const early = await api("PATCH", `/api/appointments/${apptId}/status`, { token: dentist, body: { status: "completed" } });
    assert.equal(errCode(early), "too_early");
  });

  test("reschedule moves to pending for re-confirmation; cancel frees the slot", async () => {
    const r = await api("POST", `/api/appointments/${apptId}/reschedule`, { token: maria, body: { date, startTime: "14:00" } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.startTime, "14:00");
    assert.equal(r.body.status, "pending");
    const freed = await api("GET", `/api/dentists/${elena}/availability?date=${date}&serviceId=${svc30}`);
    assert.equal(freed.body.slots.find((s) => s.startTime === "10:00").available, true);

    const c = await api("PATCH", `/api/appointments/${apptId}/status`, { token: maria, body: { status: "cancelled", reason: "Conflict at work" } });
    assert.equal(c.body.status, "cancelled");
    const freed2 = await api("GET", `/api/dentists/${elena}/availability?date=${date}&serviceId=${svc30}`);
    assert.equal(freed2.body.slots.find((s) => s.startTime === "14:00").available, true);
  });

  test("dentist time-off closes the day; weekly schedule is editable by owner only", async () => {
    const dentist = await demo("admin");
    const d2 = addDays(date, 7);
    const off = await api("POST", "/api/dentists/me/time-off", { token: dentist, body: { date: d2, reason: "Seminar" } });
    assert.equal(off.status, 201);
    const av = await api("GET", `/api/dentists/${elena}/availability?date=${d2}&serviceId=${svc30}`);
    assert.equal(av.body.dayStatus, "time_off");
    assert.equal(av.body.slots.length, 0);
    assert.equal((await api("PUT", `/api/dentists/${elena}/schedule`, { token: maria, body: { blocks: [] } })).status, 403);
    const put = await api("PUT", "/api/dentists/me/schedule", { token: dentist, body: { blocks: [{ weekday: 1, startTime: "08:00", endTime: "12:00" }, { weekday: 1, startTime: "11:00", endTime: "13:00" }] } });
    assert.equal(put.status, 422, "overlapping blocks rejected");
  });

  test("clerk books on behalf of a walk-in / Messenger patient -> confirmed", async () => {
    const clerk = await demo("clerk");
    const juan = (await api("GET", "/api/patients?q=Juan", { token: clerk })).body.items[0];
    const r = await api("POST", "/api/appointments", { token: clerk, body: { patientId: juan.id, serviceId: svc30, dentistId: elena, date, startTime: "09:00", source: "messenger" } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.status, "confirmed");
    assert.equal(r.body.source, "messenger");
  });

  test("expired holds are rejected", async () => {
    const t0 = Date.now();
    const s2 = createApp({ dbPath: ":memory:", seedOnStart: true, jwtSecret: "t".repeat(40), demoMode: true, clock: () => new Date(t0 + (globalThis.__skew ?? 0)) });
    await new Promise((r) => s2.server.listen(0, r));
    const b2 = `http://localhost:${s2.server.address().port}`;
    const call = async (m, p, tk, body) => (await fetch(b2 + p, { method: m, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` }, body: body ? JSON.stringify(body) : undefined })).json();
    const tk = (await (await fetch(b2 + "/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "patient" }) })).json()).token;
    const hold = await call("POST", "/api/slot-holds", tk, { serviceId: svc30, dentistId: elena, date, startTime: "11:00" });
    assert.ok(hold.id);
    globalThis.__skew = 6 * 60_000; // 6 minutes later (hold is 5)
    const r = await call("POST", "/api/appointments", tk, { serviceId: svc30, dentistId: elena, date, startTime: "11:00", holdId: hold.id });
    assert.equal(r.error.code, "hold_expired");
    globalThis.__skew = 0;
    await s2.close();
  });
});

describe("patient <-> dentist messaging", () => {
  test("chat works, is private, and pushes real-time events over SSE", async () => {
    const maria = await demo("patient");
    const dentistTk = await demo("admin");
    const clerk = await demo("clerk");
    const elena = (await api("GET", "/api/dentists")).body.items.find((d) => d.name.includes("Elena")).id;

    const conv = await api("POST", "/api/conversations", { token: maria, body: { dentistId: elena } });
    assert.equal(conv.status, 200); // seed already created the thread -> get-or-create returns it
    const id = conv.body.id;

    // dentist opens an SSE stream
    const ac = new AbortController();
    const stream = await fetch(base + "/api/stream", { headers: { Authorization: `Bearer ${dentistTk}` }, signal: ac.signal });
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get("content-type"), /text\/event-stream/);
    const reader = stream.body.getReader();
    let buf = "";
    const seen = (async () => {
      const dec = new TextDecoder();
      while (!buf.includes("event: message.new")) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value); }
      return buf;
    })();

    const sent = await api("POST", `/api/conversations/${id}/messages`, { token: maria, body: { body: "Can I eat before my filling?" } });
    assert.equal(sent.status, 201);
    const got = await Promise.race([seen, new Promise((_, rej) => setTimeout(() => rej(new Error("SSE timeout")), 3000))]);
    assert.match(got, /Can I eat before my filling\?/);
    ac.abort();

    const dView = await api("GET", "/api/conversations", { token: dentistTk });
    assert.ok(dView.body.unreadTotal >= 1);
    await api("POST", `/api/conversations/${id}/read`, { token: dentistTk });
    const after = await api("GET", "/api/conversations", { token: dentistTk });
    assert.equal(after.body.unreadTotal, 0);

    const history = await api("GET", `/api/conversations/${id}/messages`, { token: dentistTk });
    assert.ok(history.body.items.length >= 3);
    const poll = await api("GET", `/api/conversations/${id}/messages?after=${history.body.items[0].id}`, { token: maria });
    assert.equal(poll.body.items.length, history.body.items.length - 1);

    // privacy
    assert.equal((await api("GET", `/api/conversations/${id}/messages`, { token: clerk })).status, 403);
    const intruder = (await api("POST", "/api/auth/register", { body: { fullName: "Nosy Person", email: "nosy@example.com", password: "Passw0rdOK", phone: "09175559999" } })).body.token;
    assert.equal((await api("GET", `/api/conversations/${id}/messages`, { token: intruder })).status, 404);
    assert.equal((await api("POST", `/api/conversations/${id}/messages`, { token: maria, body: { body: "   " } })).status, 422);
  });
});

describe("queue removal", () => {
  test("queue and room endpoints are no longer available", async () => {
    assert.equal((await api("GET", "/api/queue/board")).status, 404);
    assert.equal((await api("GET", "/api/queue")).status, 404);
    assert.equal((await api("GET", "/api/rooms")).status, 404);
  });
});

describe("admin analytics & ledger", () => {
  test("analytics aggregate appointments", async () => {
    const admin = await demo("admin");
    const from = addDays(clinicNow(tzCfg).date, -90);
    const r = await api("GET", `/api/admin/analytics?from=${from}&to=${addDays(clinicNow(tzCfg).date, 30)}`, { token: admin });
    assert.equal(r.status, 200);
    assert.ok(r.body.totals.completed >= 4 && r.body.totals.noShow >= 1);
    assert.ok(r.body.noShowRatePct > 0);
    assert.ok(r.body.appointmentsByService.length && r.body.appointmentsBySource.length && r.body.appointmentsByDentist.length);
    assert.equal((await api("GET", "/api/admin/analytics?from=2026-12-01&to=2026-01-01", { token: admin })).status, 422);
  });

  test("daily ledger exports CSV (pay at counter) and neutralises formulas", async () => {
    const admin = await demo("admin");
    const today = clinicNow(tzCfg).date;
    const { db } = srv.app;
    db.prepare("UPDATE patients SET full_name = ? WHERE code = 'SC-10001'").run("=HYPERLINK(\"http://evil\")");
    db.prepare(`INSERT INTO appointments (reference, patient_id, dentist_id, service_id, date, start_time, end_time, status, source)
                VALUES ('SC-LEDGR1', (SELECT id FROM patients WHERE code='SC-10001'), 1, 4, ?, '09:00', '10:00', 'completed', 'walk_in')`).run(today);
    const res = await fetch(`${base}/api/admin/ledger.csv?date=${today}`, { headers: { Authorization: `Bearer ${admin}` } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/csv/);
    assert.match(res.headers.get("content-disposition"), /smartcare-ledger-/);
    const csv = await res.text();
    assert.match(csv, /SC-LEDGR1/);
    assert.match(csv, /Pay at counter/);
    assert.match(csv, /"1200"/);
    assert.ok(csv.includes(`"'=HYPERLINK`), "formula injection neutralised");
    assert.equal((await api("GET", "/api/admin/ledger.csv", { token: await demo("clerk") })).status, 403);
  });
});

describe("hardening", () => {
  test("CORS: allowed origin echoed, foreign origin blocked on writes", async () => {
    const ok = await api("GET", "/api/health", { headers: { Origin: "http://localhost:3000" } });
    assert.equal(ok.headers.get("access-control-allow-origin"), "http://localhost:3000");
    const evil = await api("POST", "/api/auth/login", { headers: { Origin: "http://evil.example" }, body: { email: "a@b.co", password: "x" } });
    assert.equal(evil.status, 403);
    assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
  });
  test("invalid JSON and oversized bodies", async () => {
    const bad = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{oops" });
    assert.equal(bad.status, 400);
    const big = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "a@b.co", password: "x".repeat(200_000) }) });
    assert.equal(big.status, 413);
  });
  test("SQL-injection style input is treated as data", async () => {
    const r = await api("GET", "/api/services?q=" + encodeURIComponent("'; DROP TABLE services;--"));
    assert.equal(r.status, 200);
    assert.equal((await api("GET", "/api/services")).body.items.length, 8);
  });
  test("production guards", async () => {
    const { loadConfig } = await import("../src/config.js");
    assert.throws(() => loadConfig({ isProd: true, jwtSecret: "" }), /JWT_SECRET/);
    assert.throws(() => loadConfig({ isProd: true, jwtSecret: "x", demoMode: true }), /DEMO_MODE/);
  });
});
