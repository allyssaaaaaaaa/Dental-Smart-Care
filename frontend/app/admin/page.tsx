"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/empty-state";
import { getAdminInsights, recordClinicSettlement, type AdminInsights } from "@/lib/appointments";

type DashboardTab = "diagnostic" | "predictive";

function clinicToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function daysBefore(date: string, count: number) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() - count);
  return result.toISOString().slice(0, 10);
}

function php(value: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(value);
}

function shortDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

function Panel({ title, subtitle, action, children }: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-border bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-[16px] font-semibold text-heading">{title}</h2>
          {subtitle ? <p className="mt-1 text-[12px] leading-relaxed text-muted">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Metric({ label, value, detail, accent = "text-heading" }: {
  label: string;
  value: string;
  detail: string;
  accent?: string;
}) {
  return (
    <article className="rounded-card border border-border bg-white p-4 shadow-card">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-2 font-heading text-[25px] font-bold tracking-tight ${accent}`}>{value}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">{detail}</p>
    </article>
  );
}

function Bar({ value, max, color = "bg-primary" }: { value: number; max: number; color?: string }) {
  const width = max > 0 ? Math.max(value > 0 ? 2 : 0, value / max * 100) : 0;
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-page">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export default function AdminAnalyticsPage() {
  const today = clinicToday();
  const [from, setFrom] = useState(() => daysBefore(clinicToday(), 29));
  const [to, setTo] = useState(today);
  const [tab, setTab] = useState<DashboardTab>("diagnostic");
  const [data, setData] = useState<AdminInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [demographicCategory, setDemographicCategory] = useState("all");
  const [selectedForecast, setSelectedForecast] = useState<number | null>(null);
  const [settlingId, setSettlingId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await getAdminInsights(from, to);
        if (!cancelled) {
          setData(result);
          setError("");
          setLastUpdated(new Date());
        }
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Could not load the analytics dashboard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [from, to]);

  async function refresh() {
    setLoading(true);
    try {
      const result = await getAdminInsights(from, to);
      setData(result);
      setError("");
      setLastUpdated(new Date());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load the analytics dashboard.");
    } finally {
      setLoading(false);
    }
  }

  async function settleClinicBalance(appointmentId: number) {
    setSettlingId(appointmentId);
    setError("");
    try {
      await recordClinicSettlement(appointmentId);
      const result = await getAdminInsights(from, to);
      setData(result);
      setLastUpdated(new Date());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not record the clinic balance settlement.");
    } finally {
      setSettlingId(null);
    }
  }

  const maxServiceRevenue = Math.max(1, ...(data?.servicePerformance.map((item) => item.revenuePhp) ?? []));
  const maxServiceBookings = Math.max(1, ...(data?.servicePerformance.map((item) => item.bookings) ?? []));
  const maxCancellation = Math.max(1, ...(data?.cancellationSlots.map((item) => item.cancellationRatePct) ?? []));
  const filteredDemographics = data?.demographics.filter((item) =>
    demographicCategory === "all" || item.category === demographicCategory,
  ) ?? [];
  const maxDemographicCount = Math.max(1, ...filteredDemographics.map((item) => item.appointments));
  const maxForecast = Math.max(1, ...(data?.demandForecast.days.map((item) => item.predictedBookings) ?? []));
  const forecastPoints = data?.demandForecast.days ?? [];
  const forecastAverage = forecastPoints.length && data ? data.demandForecast.predictedTotal / forecastPoints.length : 0;
  const peakDayCount = forecastPoints.filter((point) => point.predictedBookings > forecastAverage).length;
  const lowDayCount = forecastPoints.filter((point) => point.predictedBookings < forecastAverage).length;
  const graphPoints = forecastPoints.map((point, index) => {
    const x = forecastPoints.length > 1 ? 6 + index / (forecastPoints.length - 1) * 88 : 50;
    const y = 88 - point.predictedBookings / maxForecast * 72;
    return `${x},${y}`;
  }).join(" ");
  const alertCount = (data?.noShowRisk.filter((item) => item.level === "high").length ?? 0) +
    (data?.paymentAudit.onlineDepositsPending ?? 0);

  return (
    <div className="px-6 py-8 lg:px-8">
      <PageHeader
        kicker="Dentist / Admin · Clinic intelligence"
        title="Analytics dashboard"
        description="Understand what is driving clinic performance and use schedule-based forecasts to plan ahead."
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`rounded-pill px-3 py-1 text-[11px] font-semibold ${alertCount ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
            {alertCount ? `${alertCount} items need attention` : "No urgent flags"}
          </span>
          <span className="text-[11px] text-muted">{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })} · auto-refresh 60s` : "Live data"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[11px] font-medium text-muted">From
            <input type="date" value={from} max={to} onChange={(event) => { setLoading(true); setFrom(event.target.value); }} className="ml-2 rounded-btn border border-border px-2 py-1.5 text-[12px] text-heading" />
          </label>
          <label className="text-[11px] font-medium text-muted">To
            <input type="date" value={to} min={from} max={today} onChange={(event) => { setLoading(true); setTo(event.target.value); }} className="ml-2 rounded-btn border border-border px-2 py-1.5 text-[12px] text-heading" />
          </label>
          <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-btn border border-border px-3 py-2 text-[12px] font-semibold text-heading disabled:opacity-60">
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error ? <p role="alert" className="mb-5 rounded-lg bg-danger/10 px-4 py-3 text-[13px] text-danger">{error}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Appointments in range" value={String(data?.kpis.appointments ?? "—")} detail={`${data?.range.from ?? from} – ${data?.range.to ?? to}`} />
        <Metric label="Completed service revenue" value={data ? php(data.kpis.completedRevenuePhp) : "—"} detail="Completed appointments only" accent="text-primary" />
        <Metric label="Cancellation rate" value={data ? `${data.kpis.cancellationRatePct}%` : "—"} detail="Cancelled appointments ÷ all bookings" accent="text-amber-700" />
        <Metric label="High no-show risk" value={String(data?.kpis.noShowRiskCount ?? "—")} detail="Upcoming bookings flagged by history" accent={data?.kpis.noShowRiskCount ? "text-danger" : "text-heading"} />
      </div>

      <div className="mt-6 flex gap-2 border-b border-border">
        {(["diagnostic", "predictive"] as const).map((item) => (
          <button key={item} type="button" onClick={() => setTab(item)} className={`border-b-2 px-4 py-3 text-[13px] font-semibold capitalize ${tab === item ? "border-primary text-primary" : "border-transparent text-muted hover:text-heading"}`}>
            {item} analytics
          </button>
        ))}
      </div>

      {!data && loading ? <p className="mt-6 text-[13px] text-muted">Loading clinic analytics…</p> : null}

      {data && tab === "diagnostic" ? (
        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <Panel title="Service popularity vs. completed revenue" subtitle="Compare booking volume with revenue from completed appointments; high-cost treatments and high-volume care are shown separately.">
            {data.servicePerformance.length ? (
              <div className="space-y-4">
                {data.servicePerformance.slice(0, 8).map((item) => (
                  <div key={item.serviceId}>
                    <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-[12px] font-semibold text-heading">{item.name} <span className="font-normal text-muted">· {item.category}</span></span>
                      <span className="text-[11px] text-muted">{item.bookings} bookings · {php(item.revenuePhp)}</span>
                    </div>
                    <div className="grid grid-cols-[34px_1fr_82px] items-center gap-2">
                      <span className="text-[10px] text-muted">Revenue</span><Bar value={item.revenuePhp} max={maxServiceRevenue} color="bg-primary" /><span className="text-right text-[10px] text-muted">{php(item.revenuePhp)}</span>
                      <span className="text-[10px] text-muted">Volume</span><Bar value={item.bookings} max={maxServiceBookings} color="bg-sky-400" /><span className="text-right text-[10px] text-muted">{item.bookings} visits</span>
                    </div>
                  </div>
                ))}
                <div className="flex gap-4 border-t border-border pt-3 text-[10px] text-muted"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-primary" />Completed revenue</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-400" />Booking volume</span></div>
              </div>
            ) : <p className="text-[12px] text-muted">No service bookings in this period.</p>}
          </Panel>

          <Panel title="Cancellation patterns by time slot" subtitle="Cancellation rates by appointment start hour. Slots with more cancellations stand out for staffing and reminder reviews.">
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
              {data.cancellationSlots.map((slot) => (
                <div key={slot.time} title={`${slot.cancelled} cancelled of ${slot.total} bookings`} className="rounded-lg border border-border p-3">
                  <p className="text-[11px] font-semibold text-heading">{slot.time}</p>
                  <div className="mt-2"><Bar value={slot.cancellationRatePct} max={maxCancellation} color={slot.cancellationRatePct >= 25 ? "bg-rose-500" : "bg-amber-400"} /></div>
                  <p className="mt-2 text-[12px] font-bold text-heading">{slot.cancellationRatePct}%</p>
                  <p className="text-[10px] text-muted">{slot.cancelled}/{slot.total} cancelled</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-muted">Percentages are descriptive, not causal; compare with the number of bookings shown per slot.</p>
          </Panel>

          <Panel
            title="Patient demographics by treatment"
            subtitle="Appointment mix by recorded age band and sex. Missing profile information is retained as “Not specified” or “Unknown age”."
            action={(
              <select value={demographicCategory} onChange={(event) => setDemographicCategory(event.target.value)} className="rounded-btn border border-border bg-white px-2 py-1.5 text-[11px]">
                <option value="all">All treatment categories</option>
                {[...new Set(data.demographics.map((item) => item.category))].map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            )}
          >
            {filteredDemographics.length ? (
              <div className="space-y-3">
                {filteredDemographics.slice(0, 10).map((item, index) => (
                  <div key={`${item.category}-${item.ageBand}-${item.sex}`} className="grid grid-cols-[minmax(0,1fr)_minmax(80px,1.2fr)_35px] items-center gap-3">
                    <span className="truncate text-[11px] text-heading">{item.category} · {item.ageBand} · {item.sex}</span>
                    <Bar value={item.appointments} max={maxDemographicCount} color={index % 2 ? "bg-violet-400" : "bg-indigo-500"} />
                    <span className="text-right text-[11px] font-semibold text-heading">{item.appointments}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-[12px] text-muted">No demographic or treatment records in this period.</p>}
          </Panel>

          <Panel title="Online deposit & clinic balance audit" subtitle="Compare the required 50% online deposit with balances expected and actually recorded as received over the counter.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-page p-4"><p className="text-[11px] text-muted">Online bookings</p><p className="mt-1 text-[21px] font-bold text-heading">{data.paymentAudit.onlineBookings}</p></div>
              <div className="rounded-lg bg-emerald-50 p-4"><p className="text-[11px] text-emerald-800">50% deposits received</p><p className="mt-1 text-[21px] font-bold text-emerald-900">{php(data.paymentAudit.depositsReceivedPhp)}</p><p className="mt-1 text-[10px] text-emerald-800">{php(data.paymentAudit.onlineDepositExpectedPhp)} expected · {data.paymentAudit.onlineDepositsPaid} paid · {data.paymentAudit.onlineDepositsPending} pending</p></div>
              <div className="rounded-lg bg-amber-50 p-4"><p className="text-[11px] text-amber-800">Expected clinic balances</p><p className="mt-1 text-[21px] font-bold text-amber-900">{php(data.paymentAudit.clinicBalanceExpectedPhp)}</p></div>
              <div className="rounded-lg bg-sky-50 p-4"><p className="text-[11px] text-sky-800">OTC balances recorded</p><p className="mt-1 text-[21px] font-bold text-sky-900">{php(data.paymentAudit.counterBalanceSettledPhp)}</p><p className="mt-1 text-[10px] text-sky-800">{php(data.paymentAudit.counterBalanceUnrecordedPhp)} unrecorded for completed visits</p></div>
              <div className="rounded-lg bg-sky-50 p-4"><p className="text-[11px] text-sky-800">Online booking value</p><p className="mt-1 text-[21px] font-bold text-sky-900">{php(data.paymentAudit.onlineBookingValuePhp)}</p></div>
            </div>
            {data.paymentAudit.counterPayments.length ? (
              <div className="mt-4">
                <h3 className="text-[12px] font-semibold text-heading">Completed visits awaiting balance record</h3>
                <div className="mt-2 space-y-2">
                  {data.paymentAudit.counterPayments.map((payment) => (
                    <div key={payment.appointmentId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5">
                      <div><p className="text-[11px] font-semibold text-heading">{payment.patientName} · {payment.service}</p><p className="text-[10px] text-muted">{shortDate(payment.date)} · Expected balance {php(payment.amountDuePhp)}</p></div>
                      <button type="button" onClick={() => void settleClinicBalance(payment.appointmentId)} disabled={settlingId !== null} className="rounded-btn bg-primary px-3 py-2 text-[10px] font-semibold text-white disabled:opacity-60">
                        {settlingId === payment.appointmentId ? "Recording…" : "Mark balance received"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : <p className="mt-4 text-[11px] text-muted">No completed appointment balances are awaiting a settlement record in this date range.</p>}
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">Older completed balances remain unrecorded until staff records collection; an unrecorded balance does not prove whether the patient did or did not pay. Recording is limited to completed visits.</p>
          </Panel>
        </div>
      ) : null}

      {data && tab === "predictive" ? (
        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <Panel title="30-day booking demand forecast" subtitle={`Estimated ${data.demandForecast.predictedTotal} bookings · ${data.demandForecast.changePct >= 0 ? "+" : ""}${data.demandForecast.changePct}% versus weekday baseline. Forecast uses recent weekday booking history.`}>
            <div className="rounded-lg border border-border bg-white p-2">
              <svg viewBox="0 0 100 100" role="img" aria-label="Estimated daily bookings over the next 30 days" className="h-56 w-full overflow-visible">
                {[20, 40, 60, 80].map((y) => <line key={y} x1="5" y1={y} x2="96" y2={y} stroke="#e2e8f0" strokeWidth=".5" />)}
                {graphPoints ? <polyline points={graphPoints} fill="none" stroke="#0f766e" strokeWidth="1.8" vectorEffect="non-scaling-stroke" /> : null}
                {forecastPoints.map((point, index) => {
                  const x = forecastPoints.length > 1 ? 6 + index / (forecastPoints.length - 1) * 88 : 50;
                  const y = 88 - point.predictedBookings / maxForecast * 72;
                  const peak = point.predictedBookings > forecastAverage;
                  return <circle key={point.date} cx={x} cy={y} r={selectedForecast === index ? "1.9" : "1.1"} fill={selectedForecast === index ? "#f97316" : peak ? "#dc2626" : "#0284c7"} tabIndex={0} role="button" aria-label={`${point.date}: ${point.predictedBookings} forecast bookings`} onClick={() => setSelectedForecast(index)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedForecast(index); }}><title>{point.date}: {point.predictedBookings} expected · {peak ? "peak demand" : "lower demand"}</title></circle>;
                })}
              </svg>
              <div className="flex justify-between px-1 text-[10px] text-muted"><span>{forecastPoints[0] ? shortDate(forecastPoints[0].date) : ""}</span><span>Next 30 days</span><span>{forecastPoints.at(-1) ? shortDate(forecastPoints.at(-1)!.date) : ""}</span></div>
            </div>
            {selectedForecast !== null && forecastPoints[selectedForecast] ? (
              <p className="mt-3 rounded-lg bg-tint-2 px-3 py-2 text-[12px] text-heading">
                {shortDate(forecastPoints[selectedForecast].date)} · {forecastPoints[selectedForecast].predictedBookings} estimated bookings · {forecastPoints[selectedForecast].predictedBookings > forecastAverage ? "peak demand day" : "lower demand day"}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-muted"><span className="rounded-pill bg-emerald-100 px-2 py-1 text-emerald-800">Peak demand days: {peakDayCount}</span><span className="rounded-pill bg-page px-2 py-1">Lower demand days: {lowDayCount}</span><span className="rounded-pill bg-sky-50 px-2 py-1 text-sky-800">Weekday-baseline forecast</span></div>
          </Panel>

          <Panel title="Monthly revenue projection" subtitle={`Confirmed and completed appointments in ${data.revenueProjection.month}; unpaid online requests are excluded.`}>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-primary/5 p-4"><p className="text-[11px] text-muted">Projected service value</p><p className="mt-2 text-[20px] font-bold text-primary">{php(data.revenueProjection.projectedRevenuePhp)}</p></div>
              <div className="rounded-lg bg-emerald-50 p-4"><p className="text-[11px] text-emerald-800">Confirmed deposits</p><p className="mt-2 text-[20px] font-bold text-emerald-900">{php(data.revenueProjection.confirmedDepositsPhp)}</p></div>
              <div className="rounded-lg bg-amber-50 p-4"><p className="text-[11px] text-amber-800">Expected clinic balance</p><p className="mt-2 text-[20px] font-bold text-amber-900">{php(data.revenueProjection.clinicBalanceExpectedPhp)}</p></div>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-[12px]"><span className="text-muted">Confirmed/completed appointments</span><span className="font-semibold text-heading">{data.revenueProjection.confirmedBookings}</span></div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted">Projection sums listed service prices for eligible appointments; it is booked value, not recognized accounting revenue or a guarantee of collection.</p>
          </Panel>

          <Panel title="Upcoming patient no-show risk" subtitle="Heuristic indicator based on the patient’s previous no-shows/cancellations and historical no-shows by hour. It is a triage signal, not a clinical judgment.">
            {data.noShowRisk.length ? (
              <div className="space-y-2">
                {data.noShowRisk.map((item) => (
                  <article key={item.appointmentId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                    <div><p className="text-[12px] font-semibold text-heading">{item.patientName} · {item.service}</p><p className="mt-1 text-[10px] text-muted">{shortDate(item.date)} at {item.startTime} · {item.reason}</p></div>
                    <span className={`rounded-pill px-2.5 py-1 text-[10px] font-bold uppercase ${item.level === "high" ? "bg-rose-100 text-rose-800" : item.level === "medium" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                      {item.level} · {item.score}%
                    </span>
                  </article>
                ))}
              </div>
            ) : <p className="text-[12px] text-muted">No upcoming pending or confirmed bookings in the next 30 days.</p>}
          </Panel>

          <Panel title="Procedure-linked supply reorder predictor" subtitle="Upcoming procedure volume for the next 30 days. Inventory quantities and per-procedure usage are not stored, so validate stock before reordering.">
            {data.supplyForecast.length ? (
              <div className="space-y-3">
                {data.supplyForecast.slice(0, 10).map((item) => (
                  <div key={`${item.category}-${item.service}`} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                    <div><p className="text-[12px] font-semibold text-heading">{item.service}</p><p className="text-[10px] text-muted">{item.category} · suggested supply group: {item.category}</p></div>
                    <div className="flex items-center gap-2"><span className="text-[12px] font-semibold text-heading">{item.appointments} procedures</span><span className="rounded-pill bg-amber-100 px-2 py-1 text-[9px] font-bold uppercase text-amber-800">Check stock</span></div>
                  </div>
                ))}
              </div>
            ) : <p className="text-[12px] text-muted">No upcoming procedures are scheduled in the next 30 days.</p>}
            <p className="mt-3 rounded-lg bg-page px-3 py-2 text-[11px] leading-relaxed text-muted">Schedule-driven demand only. Add actual inventory and procedure-to-supply usage to calculate reorder quantities and thresholds.</p>
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
