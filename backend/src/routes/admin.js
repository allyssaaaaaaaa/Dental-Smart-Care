import { Reply, requireRole } from "../lib/router.js";
import { addDays, ageFrom, clinicNow, weekdayOf } from "../lib/time.js";
import { conflict, invalid, notFound } from "../lib/errors.js";
import { parseQuery } from "../lib/validate.js";

// CSV hardening: quote everything and neutralise spreadsheet formulas (=, +, -, @)
function csvCell(v) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export default function register(router) {
  router.get("/api/admin/insights", requireRole("admin"), (ctx) => {
    const today = clinicNow(ctx.config).date;
    const q = parseQuery(ctx.query, {
      from: { type: "date", default: addDays(today, -29) },
      to: { type: "date", default: today },
    });
    if (q.from > q.to) throw invalid("from must be on or before to", { from: "Invalid range" });
    const { db } = ctx;
    const range = [q.from, q.to];
    const appointments = db.prepare(
      `SELECT a.id, a.patient_id, a.service_id, a.date, a.start_time, a.status, a.source,
              p.full_name AS patient_name, p.birth_date, p.sex,
              s.name AS service_name, s.category AS service_category, s.price_php,
              pay.status AS payment_status, pay.amount_centavos, cp.amount_centavos AS counter_paid_centavos
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN services s ON s.id = a.service_id
       LEFT JOIN appointment_payments pay ON pay.appointment_id = a.id
       LEFT JOIN appointment_counter_payments cp ON cp.appointment_id = a.id
       WHERE a.date BETWEEN ? AND ? AND p.is_demo = 0`,
    ).all(...range);

    const byService = new Map();
    for (const appt of appointments) {
      const item = byService.get(appt.service_id) ?? {
        serviceId: appt.service_id, name: appt.service_name, category: appt.service_category,
        bookings: 0, completed: 0, cancelled: 0, revenuePhp: 0,
      };
      item.bookings += 1;
      if (appt.status === "completed") {
        item.completed += 1;
        item.revenuePhp += appt.price_php;
      }
      if (appt.status === "cancelled") item.cancelled += 1;
      byService.set(appt.service_id, item);
    }
    const servicePerformance = [...byService.values()].sort((a, b) => b.revenuePhp - a.revenuePhp || b.bookings - a.bookings);

    const cancellationSlots = Array.from({ length: 9 }, (_, index) => {
      const hour = index + 8;
      const slotAppts = appointments.filter((appt) => Number(appt.start_time.slice(0, 2)) === hour);
      const cancelled = slotAppts.filter((appt) => appt.status === "cancelled").length;
      return { time: `${String(hour).padStart(2, "0")}:00`, total: slotAppts.length, cancelled,
        cancellationRatePct: slotAppts.length ? Math.round(cancelled / slotAppts.length * 1000) / 10 : 0 };
    });

    const demographics = new Map();
    for (const appt of appointments) {
      let ageBand = "Unknown age";
      const age = ageFrom(appt.birth_date, today);
      if (age !== null) ageBand = age < 18 ? "Under 18" : age < 30 ? "18–29" : age < 45 ? "30–44" : age < 60 ? "45–59" : "60+";
      const sex = appt.sex ?? "Not specified";
      const key = `${appt.service_category}|${ageBand}|${sex}`;
      const row = demographics.get(key) ?? { category: appt.service_category, ageBand, sex, appointments: 0 };
      row.appointments += 1;
      demographics.set(key, row);
    }

    const online = appointments.filter((appt) => appt.source === "online_portal");
    const depositsReceivedPhp = online.reduce((sum, appt) =>
      sum + (appt.payment_status === "paid" ? (appt.amount_centavos ?? 0) / 100 : 0), 0);
    const onlineValuePhp = online.reduce((sum, appt) => sum + appt.price_php, 0);
    const counterBalanceExpectedPhp = appointments.reduce((sum, appt) =>
      sum + Math.max(0, appt.price_php - (appt.source === "online_portal"
        ? appt.payment_status === "paid" ? (appt.amount_centavos ?? 0) / 100 : appt.price_php / 2
        : 0)), 0);
    const completedCounterPayments = appointments.filter((appt) => appt.status === "completed");
    const counterBalanceSettledCentavos = completedCounterPayments.reduce((sum, appt) => sum + (appt.counter_paid_centavos ?? 0), 0);
    const counterPayments = completedCounterPayments.map((appt) => {
      const deposit = appt.source === "online_portal" && appt.payment_status === "paid" ? (appt.amount_centavos ?? 0) : 0;
      const amountDueCentavos = Math.max(0, appt.price_php * 100 - deposit - (appt.counter_paid_centavos ?? 0));
      return {
        appointmentId: appt.id,
        patientName: appt.patient_name,
        date: appt.date,
        service: appt.service_name,
        amountDuePhp: amountDueCentavos / 100,
        settledPhp: (appt.counter_paid_centavos ?? 0) / 100,
        status: appt.counter_paid_centavos ? "settled" : "unrecorded",
      };
    }).filter((item) => item.status === "unrecorded").slice(0, 20);
    const paymentAudit = {
      onlineBookings: online.length,
      onlineDepositsPaid: online.filter((appt) => appt.payment_status === "paid").length,
      onlineDepositsPending: online.filter((appt) => appt.payment_status !== "paid").length,
      onlineDepositExpectedPhp: online.reduce((sum, appt) => sum + appt.price_php / 2, 0),
      depositsReceivedPhp: Math.round(depositsReceivedPhp * 100) / 100,
      onlineBookingValuePhp: onlineValuePhp,
      clinicBalanceExpectedPhp: counterBalanceExpectedPhp,
      counterBalanceSettledPhp: counterBalanceSettledCentavos / 100,
      counterBalanceUnrecordedPhp: completedCounterPayments.reduce((sum, appt) => {
        if (appt.counter_paid_centavos) return sum;
        const deposit = appt.source === "online_portal" && appt.payment_status === "paid" ? (appt.amount_centavos ?? 0) : 0;
        return sum + Math.max(0, appt.price_php * 100 - deposit) / 100;
      }, 0),
      counterSettlementsTracked: true,
      counterPayments,
    };

    const priorStart = addDays(today, -60);
    const recentStart = addDays(today, -30);
    const priorCount = db.prepare(
      "SELECT COUNT(*) AS n FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.date >= ? AND a.date < ? AND p.is_demo = 0",
    ).get(priorStart, recentStart).n;
    const recentCount = db.prepare(
      "SELECT COUNT(*) AS n FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.date >= ? AND a.date < ? AND p.is_demo = 0",
    ).get(recentStart, today).n;
    const trendFactor = priorCount ? Math.max(0.65, Math.min(1.5, recentCount / priorCount)) : 1;
    const weekdayCounts = db.prepare(
      `SELECT CAST(strftime('%w', a.date) AS INTEGER) AS weekday, COUNT(*) AS n
       FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.date >= ? AND a.date < ? AND p.is_demo = 0 GROUP BY weekday`,
    ).all(addDays(today, -56), today);
    const weekdayAverage = new Map(weekdayCounts.map((row) => [row.weekday, row.n / 8]));
    const demandForecast = Array.from({ length: 30 }, (_, index) => {
      const date = addDays(today, index + 1);
      return { date, predictedBookings: Math.round((weekdayAverage.get(weekdayOf(date)) ?? 0) * trendFactor * 10) / 10 };
    });
    const predictedTotal = demandForecast.reduce((sum, day) => sum + day.predictedBookings, 0);
    const baselineTotal = demandForecast.reduce((sum, day) => sum + (weekdayAverage.get(weekdayOf(day.date)) ?? 0), 0);
    const demandChangePct = baselineTotal ? Math.round((predictedTotal / baselineTotal - 1) * 100) : 0;

    const monthStart = `${today.slice(0, 7)}-01`;
    const monthEnd = `${today.slice(0, 7)}-${String(new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;
    const monthRows = db.prepare(
      `SELECT a.status, s.price_php, a.source, pay.status AS payment_status, pay.amount_centavos
       FROM appointments a JOIN services s ON s.id = a.service_id JOIN patients p ON p.id = a.patient_id
       LEFT JOIN appointment_payments pay ON pay.appointment_id = a.id
       WHERE a.date BETWEEN ? AND ? AND a.status IN ('confirmed','completed')
         AND p.is_demo = 0
         AND (a.source != 'online_portal' OR pay.status = 'paid')`,
    ).all(monthStart, monthEnd);
    const revenueProjection = {
      month: today.slice(0, 7),
      confirmedBookings: monthRows.length,
      projectedRevenuePhp: monthRows.reduce((sum, row) => sum + row.price_php, 0),
      confirmedDepositsPhp: monthRows.reduce((sum, row) => sum + (row.payment_status === "paid" ? (row.amount_centavos ?? 0) / 100 : 0), 0),
      clinicBalanceExpectedPhp: monthRows.reduce((sum, row) =>
        sum + Math.max(0, row.price_php - (row.source === "online_portal"
          ? row.payment_status === "paid" ? (row.amount_centavos ?? 0) / 100 : row.price_php / 2
          : 0)), 0),
    };

    const upcoming = db.prepare(
      `SELECT a.id, a.patient_id, a.date, a.start_time, a.status, p.full_name AS patient_name,
              s.name AS service_name, s.category AS service_category
       FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN services s ON s.id = a.service_id
       WHERE a.date BETWEEN ? AND ? AND a.status IN ('pending','confirmed') AND p.is_demo = 0
       ORDER BY a.date, a.start_time LIMIT 100`,
    ).all(today, addDays(today, 30));
    const patientHistory = db.prepare(
      `SELECT patient_id, COUNT(*) AS visits,
              SUM(status = 'no_show') AS no_shows, SUM(status = 'cancelled') AS cancellations
       FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.date < ? AND p.is_demo = 0 GROUP BY patient_id`,
    ).all(today);
    const historyByPatient = new Map(patientHistory.map((row) => [row.patient_id, row]));
    const slotHistory = db.prepare(
      `SELECT substr(start_time,1,2) AS hour, COUNT(*) AS total, SUM(status = 'no_show') AS no_shows
       FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.date < ? AND p.is_demo = 0 GROUP BY hour`,
    ).all(today);
    const slotRisk = new Map(slotHistory.map((row) => [row.hour, row.total ? row.no_shows / row.total : 0]));
    const noShowRisk = upcoming.map((appt) => {
      const history = historyByPatient.get(appt.patient_id);
      const patientRate = history?.visits ? (history.no_shows + history.cancellations * 0.35) / history.visits : 0;
      const slotRate = slotRisk.get(appt.start_time.slice(0, 2)) ?? 0;
      const score = Math.min(95, Math.round(patientRate * 70 + slotRate * 30));
      return {
        appointmentId: appt.id, patientName: appt.patient_name, date: appt.date, startTime: appt.start_time,
        service: appt.service_name, score, level: score >= 50 ? "high" : score >= 25 ? "medium" : "low",
        reason: history?.visits ? `${history.no_shows} prior no-shows and ${history.cancellations} cancellations` : "No prior appointment history",
      };
    }).sort((a, b) => b.score - a.score).slice(0, 12);

    const supplyForecast = db.prepare(
      `SELECT s.category, s.name AS service, COUNT(*) AS appointments
       FROM appointments a JOIN services s ON s.id = a.service_id JOIN patients p ON p.id = a.patient_id
       WHERE a.date BETWEEN ? AND ? AND a.status IN ('pending','confirmed') AND p.is_demo = 0
       GROUP BY s.category, s.name ORDER BY appointments DESC`,
    ).all(today, addDays(today, 30));

    return {
      range: { from: q.from, to: q.to },
      kpis: {
        appointments: appointments.length,
        completedRevenuePhp: appointments.filter((appt) => appt.status === "completed").reduce((sum, appt) => sum + appt.price_php, 0),
        cancellationRatePct: appointments.length
          ? Math.round(appointments.filter((appt) => appt.status === "cancelled").length / appointments.length * 1000) / 10 : 0,
        noShowRiskCount: noShowRisk.filter((appt) => appt.level === "high").length,
      },
      servicePerformance,
      cancellationSlots,
      demographics: [...demographics.values()].sort((a, b) => b.appointments - a.appointments),
      paymentAudit,
      demandForecast: { days: demandForecast, predictedTotal: Math.round(predictedTotal * 10) / 10, changePct: demandChangePct },
      revenueProjection,
      noShowRisk,
      supplyForecast,
    };
  });

  router.post("/api/admin/appointments/:id/settlement", requireRole("admin"), (ctx) => {
    const appointment = ctx.db.prepare(
      `SELECT a.id, a.status, a.source, s.price_php, pay.status AS payment_status, pay.amount_centavos
       FROM appointments a JOIN services s ON s.id = a.service_id
       LEFT JOIN appointment_payments pay ON pay.appointment_id = a.id
       WHERE a.id = ?`,
    ).get(ctx.params.id);
    if (!appointment) throw notFound("Appointment");
    if (appointment.status !== "completed") {
      throw conflict("appointment_not_completed", "Clinic balances can only be settled for completed appointments.");
    }
    if (ctx.db.prepare("SELECT 1 FROM appointment_counter_payments WHERE appointment_id = ?").get(appointment.id)) {
      throw conflict("balance_already_settled", "A clinic balance settlement is already recorded for this appointment.");
    }
    if (appointment.source === "online_portal" && appointment.payment_status !== "paid") {
      throw conflict("deposit_required", "The online deposit must be recorded before settling the remaining clinic balance.");
    }
    const depositCentavos = appointment.source === "online_portal" ? (appointment.amount_centavos ?? 0) : 0;
    const amountCentavos = appointment.price_php * 100 - depositCentavos;
    if (amountCentavos <= 0) throw conflict("no_balance_due", "There is no remaining clinic balance to settle.");
    ctx.db.prepare(
      "INSERT INTO appointment_counter_payments (appointment_id, amount_centavos, received_by) VALUES (?,?,?)",
    ).run(appointment.id, amountCentavos, ctx.user.id);
    return {
      appointmentId: appointment.id,
      amountPhp: amountCentavos / 100,
      status: "settled",
    };
  });

  router.get("/api/admin/analytics", requireRole("admin"), (ctx) => {
    const now = clinicNow(ctx.config).date;
    const q = parseQuery(ctx.query, { from: { type: "date", default: addDays(now, -29) }, to: { type: "date", default: now } });
    if (q.from > q.to) throw invalid("from must be on or before to", { from: "Invalid range" });
    const { db } = ctx;
    const range = [q.from, q.to];

    const byStatus = Object.fromEntries(
      db.prepare("SELECT a.status, COUNT(*) AS n FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.date BETWEEN ? AND ? AND p.is_demo = 0 GROUP BY a.status").all(...range).map((r) => [r.status, r.n]),
    );
    const n = (s) => byStatus[s] ?? 0;
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const finished = n("completed") + n("no_show");

    const revenue = db.prepare(
      `SELECT COALESCE(SUM(s.price_php),0) AS v FROM appointments a JOIN services s ON s.id = a.service_id JOIN patients p ON p.id = a.patient_id
       WHERE a.status = 'completed' AND a.date BETWEEN ? AND ? AND p.is_demo = 0`,
    ).get(...range).v;

    return {
      range: { from: q.from, to: q.to },
      totals: {
        appointments: total, pending: n("pending"), confirmed: n("confirmed"), completed: n("completed"),
        cancelled: n("cancelled"), declined: n("declined"), noShow: n("no_show"), revenuePhp: revenue,
        uniquePatients: db.prepare("SELECT COUNT(DISTINCT a.patient_id) AS n FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.date BETWEEN ? AND ? AND p.is_demo = 0").get(...range).n,
        newPatients: db.prepare("SELECT COUNT(*) AS n FROM patients WHERE substr(created_at,1,10) BETWEEN ? AND ? AND is_demo = 0").get(...range).n,
      },
      noShowRatePct: finished ? Math.round((n("no_show") / finished) * 1000) / 10 : 0,
      appointmentsByService: db.prepare(
        `SELECT s.id AS serviceId, s.name, COUNT(*) AS count,
                COALESCE(SUM(CASE WHEN a.status='completed' THEN s.price_php END),0) AS revenuePhp
         FROM appointments a JOIN services s ON s.id = a.service_id JOIN patients p ON p.id = a.patient_id
         WHERE a.date BETWEEN ? AND ? AND p.is_demo = 0 GROUP BY s.id ORDER BY count DESC`,
      ).all(...range),
      appointmentsBySource: db.prepare("SELECT a.source, COUNT(*) AS count FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.date BETWEEN ? AND ? AND p.is_demo = 0 GROUP BY a.source ORDER BY count DESC").all(...range),
      appointmentsByDentist: db.prepare(
        `SELECT d.id AS dentistId, u.full_name AS name, COUNT(*) AS count,
                SUM(a.status='completed') AS completed, SUM(a.status='no_show') AS noShow
         FROM appointments a JOIN dentists d ON d.id = a.dentist_id JOIN users u ON u.id = d.user_id JOIN patients p ON p.id = a.patient_id
         WHERE a.date BETWEEN ? AND ? AND p.is_demo = 0 GROUP BY d.id, u.full_name ORDER BY count DESC`,
      ).all(...range),
      daily: db.prepare(
        `SELECT date, COUNT(*) AS total, SUM(status='no_show') AS noShow, SUM(status='completed') AS completed
         FROM appointments a JOIN patients p ON p.id = a.patient_id
         WHERE a.date BETWEEN ? AND ? AND p.is_demo = 0 GROUP BY a.date ORDER BY a.date`,
      ).all(...range),
      today: {
        date: now,
        appointments: db.prepare("SELECT COUNT(*) AS n FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.date = ? AND a.status IN ('pending','confirmed','completed') AND p.is_demo = 0").get(now).n,
      },
    };
  });

  // "Export Daily Ledger" - completed visits with online deposits and counter balances.
  router.get("/api/admin/ledger.csv", requireRole("admin"), (ctx) => {
    const { date } = parseQuery(ctx.query, { date: { type: "date", default: clinicNow(ctx.config).date } });
    const rows = ctx.db.prepare(
      `SELECT a.reference, a.start_time, a.source, p.code AS patient_code, p.full_name AS patient, s.name AS service, du.full_name AS dentist, s.price_php,
              CASE WHEN pay.status = 'paid' THEN pay.amount_centavos ELSE 0 END AS amount_centavos,
              cp.amount_centavos AS counter_paid_centavos
       FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN services s ON s.id = a.service_id
       JOIN dentists d ON d.id = a.dentist_id JOIN users du ON du.id = d.user_id
       LEFT JOIN appointment_payments pay ON pay.appointment_id = a.id
       LEFT JOIN appointment_counter_payments cp ON cp.appointment_id = a.id
       WHERE a.date = ? AND a.status = 'completed' AND p.is_demo = 0 ORDER BY a.start_time`,
    ).all(date);
    const lines = [["Reference", "Date", "Time", "Patient ID", "Patient", "Service", "Dentist", "Source", "Amount (PHP)", "Online deposit (PHP)", "OTC received (PHP)", "Due at clinic (PHP)"]];
    for (const r of rows) {
      const deposit = r.amount_centavos ? r.amount_centavos / 100 : 0;
      const counterPaid = (r.counter_paid_centavos ?? 0) / 100;
      lines.push([r.reference, date, r.start_time, r.patient_code, r.patient, r.service, r.dentist, r.source, r.price_php, deposit, counterPaid, r.price_php - deposit - counterPaid]);
    }
    lines.push(["TOTAL", "", "", "", "", "", "", "", rows.reduce((s, r) => s + r.price_php, 0),
      rows.reduce((s, r) => s + (r.amount_centavos ? r.amount_centavos / 100 : 0), 0),
      rows.reduce((s, r) => s + (r.counter_paid_centavos ?? 0) / 100, 0),
      rows.reduce((s, r) => s + r.price_php - (r.amount_centavos ? r.amount_centavos / 100 : 0) - (r.counter_paid_centavos ?? 0) / 100, 0)]);
    const csv = `\uFEFF${lines.map((l) => l.map(csvCell).join(",")).join("\r\n")}\r\n`;
    return new Reply(200, csv, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="smartcare-ledger-${date}.csv"`,
    });
  });
}
