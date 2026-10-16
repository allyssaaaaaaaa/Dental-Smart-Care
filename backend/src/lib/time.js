// All dates are "YYYY-MM-DD" and all times "HH:MM" in clinic-local time.
export const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const overlaps = (aS, aE, bS, bE) => aS < bE && bS < aE;

export function weekdayOf(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
}
export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function clinicNow(config) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.clinicTz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(config.clock());
  const g = (t) => parts.find((p) => p.type === t).value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
}
// SQLite datetime('now') -> ISO 8601 UTC
export const iso = (s) => (s ? `${s.replace(" ", "T")}Z` : null);
export function ageFrom(birthDate, today) {
  if (!birthDate) return null;
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
}
