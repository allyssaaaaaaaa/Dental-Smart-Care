import { Reply, requireRole } from "../lib/router.js";
import { addDays, clinicNow } from "../lib/time.js";
import { invalid } from "../lib/errors.js";
import { parseQuery } from "../lib/validate.js";

// CSV hardening: quote everything and neutralise spreadsheet formulas (=, +, -, @)
function csvCell(v) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export default function register(router) {
  router.get("/api/admin/analytics", requireRole("admin"), (ctx) => {
    const now = clinicNow(ctx.config).date;
    const q = parseQuery(ctx.query, { from: { type: "date", default: addDays(now, -29) }, to: { type: "date", default: now } });
    if (q.from > q.to) throw invalid("from must be on or before to", { from: "Invalid range" });
    const { db } = ctx;
    const range = [q.from, q.to];

    const byStatus = Object.fromEntries(
      db.prepare("SELECT status, COUNT(*) AS n FROM appointments WHERE date BETWEEN ? AND ? GROUP BY status").all(...range).map((r) => [r.status, r.n]),
    );
    const n = (s) => byStatus[s] ?? 0;
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const finished = n("completed") + n("no_show");

    const revenue = db.prepare(
      `SELECT COALESCE(SUM(s.price_php),0) AS v FROM appointments a JOIN services s ON s.id = a.service_id
       WHERE a.status = 'completed' AND a.date BETWEEN ? AND ?`,
    ).get(...range).v;

    return {
      range: { from: q.from, to: q.to },
      totals: {
        appointments: total, pending: n("pending"), confirmed: n("confirmed"), completed: n("completed"),
        cancelled: n("cancelled"), declined: n("declined"), noShow: n("no_show"), revenuePhp: revenue,
        uniquePatients: db.prepare("SELECT COUNT(DISTINCT patient_id) AS n FROM appointments WHERE date BETWEEN ? AND ?").get(...range).n,
        newPatients: db.prepare("SELECT COUNT(*) AS n FROM patients WHERE substr(created_at,1,10) BETWEEN ? AND ?").get(...range).n,
      },
      noShowRatePct: finished ? Math.round((n("no_show") / finished) * 1000) / 10 : 0,
      appointmentsByService: db.prepare(
        `SELECT s.id AS serviceId, s.name, COUNT(*) AS count,
                COALESCE(SUM(CASE WHEN a.status='completed' THEN s.price_php END),0) AS revenuePhp
         FROM appointments a JOIN services s ON s.id = a.service_id
         WHERE a.date BETWEEN ? AND ? GROUP BY s.id ORDER BY count DESC`,
      ).all(...range),
      appointmentsBySource: db.prepare("SELECT source, COUNT(*) AS count FROM appointments WHERE date BETWEEN ? AND ? GROUP BY source ORDER BY count DESC").all(...range),
      appointmentsByDentist: db.prepare(
        `SELECT d.id AS dentistId, u.full_name AS name, COUNT(*) AS count,
                SUM(a.status='completed') AS completed, SUM(a.status='no_show') AS noShow
         FROM appointments a JOIN dentists d ON d.id = a.dentist_id JOIN users u ON u.id = d.user_id
         WHERE a.date BETWEEN ? AND ? GROUP BY d.id ORDER BY count DESC`,
      ).all(...range),
      daily: db.prepare(
        `SELECT date, COUNT(*) AS total, SUM(status='no_show') AS noShow, SUM(status='completed') AS completed
         FROM appointments WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date`,
      ).all(...range),
      today: {
        date: now,
        appointments: db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE date = ? AND status IN ('pending','confirmed','completed')").get(now).n,
      },
    };
  });

  // "Export Daily Ledger" - completed visits and amounts due/collected at the counter (no online payments)
  router.get("/api/admin/ledger.csv", requireRole("admin"), (ctx) => {
    const { date } = parseQuery(ctx.query, { date: { type: "date", default: clinicNow(ctx.config).date } });
    const rows = ctx.db.prepare(
      `SELECT a.reference, a.start_time, a.source, p.code AS patient_code, p.full_name AS patient, s.name AS service, du.full_name AS dentist, s.price_php
       FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN services s ON s.id = a.service_id
       JOIN dentists d ON d.id = a.dentist_id JOIN users du ON du.id = d.user_id
       WHERE a.date = ? AND a.status = 'completed' ORDER BY a.start_time`,
    ).all(date);
    const lines = [["Reference", "Date", "Time", "Patient ID", "Patient", "Service", "Dentist", "Source", "Amount (PHP)", "Payment"]];
    for (const r of rows) lines.push([r.reference, date, r.start_time, r.patient_code, r.patient, r.service, r.dentist, r.source, r.price_php, "Pay at counter"]);
    lines.push(["TOTAL", "", "", "", "", "", "", "", rows.reduce((s, r) => s + r.price_php, 0), ""]);
    const csv = `\uFEFF${lines.map((l) => l.map(csvCell).join(",")).join("\r\n")}\r\n`;
    return new Reply(200, csv, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="smartcare-ledger-${date}.csv"`,
    });
  });
}
