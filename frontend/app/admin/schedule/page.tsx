"use client";

import { useEffect, useMemo, useState } from "react";
import { MonthCalendar } from "@/components/ui/month-calendar";
import { PageHeader } from "@/components/ui/empty-state";
import {
  formatAppointmentDate,
  formatAppointmentTime,
  getAppointments,
  serviceColor,
  updateAppointmentStatus,
  type Appointment,
} from "@/lib/appointments";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const endDay = new Date(year, monthNumber, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(endDay).padStart(2, "0")}` };
}

export default function AdminSchedulePage() {
  const [month, setMonth] = useState(currentMonth);
  const [selectedDate, setSelectedDate] = useState("");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loadedMonth, setLoadedMonth] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState("");
  const loading = loadedMonth !== month;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { from, to } = monthBounds(month);
      try {
        const firstPage = await getAppointments(`from=${from}&to=${to}&page=1&pageSize=100&order=asc`);
        const pages = await Promise.all(
          Array.from({ length: Math.ceil(firstPage.total / firstPage.pageSize) - 1 }, (_, index) =>
            getAppointments(`from=${from}&to=${to}&page=${index + 2}&pageSize=100&order=asc`),
          ),
        );
        if (cancelled) return;
        setAppointments([...firstPage.items, ...pages.flatMap((page) => page.items)]);
        setError("");
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Could not load the clinic schedule.");
      } finally {
        if (!cancelled) setLoadedMonth(month);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [month, refreshKey]);

  useEffect(() => {
    const refreshOnFocus = () => setRefreshKey((current) => current + 1);
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, []);

  const dayData = useMemo(() => {
    const counts: Record<string, {
      appointmentCount: number;
      markers: Array<{ color: string; key: string; noShow?: boolean }>;
      noShowCount: number;
    }> = {};
    for (const appointment of appointments) {
      const day = counts[appointment.date] ?? { appointmentCount: 0, markers: [], noShowCount: 0 };
      day.appointmentCount += 1;
      if (appointment.status === "no_show") day.noShowCount += 1;
      const key = appointment.status === "no_show" ? "no-show" : appointment.service.category;
      if (!day.markers.some((marker) => marker.key === key)) {
        day.markers.push({
          key,
          color: appointment.status === "no_show" ? "#dc2626" : serviceColor(appointment.service.category),
          noShow: appointment.status === "no_show",
        });
      }
      counts[appointment.date] = day;
    }
    return counts;
  }, [appointments]);
  const selectedAppointments = useMemo(
    () => appointments.filter((appointment) => appointment.date === selectedDate),
    [appointments, selectedDate],
  );
  const serviceLegend = useMemo(
    () => [...new Map(appointments.map((appointment) => [
      appointment.service.category,
      { category: appointment.service.category, color: serviceColor(appointment.service.category) },
    ])).values()],
    [appointments],
  );

  async function setStatus(appointment: Appointment, status: "confirmed" | "declined" | "no_show") {
    setUpdatingId(appointment.id);
    setError("");
    try {
      const updated = await updateAppointmentStatus(appointment.id, status);
      setAppointments((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not update this appointment.");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="px-6 py-8 lg:px-8">
      <PageHeader
        title="Appointment Calendar"
        description="View patient bookings by day and confirm or decline pending requests."
      />
      {error ? <p role="alert" className="mb-4 rounded-lg bg-danger/10 px-4 py-3 text-[13px] text-danger">{error}</p> : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.2fr)]">
        <MonthCalendar
          month={month}
          selectedDate={selectedDate}
          dayData={dayData}
          mode="appointments"
          onMonthChange={(nextMonth) => {
            setLoadedMonth(null);
            setMonth(nextMonth);
            setSelectedDate("");
          }}
          onSelectDate={setSelectedDate}
        />
        {serviceLegend.length ? (
          <div className="flex flex-wrap gap-x-3 gap-y-2 text-[11px] text-muted xl:col-start-1 xl:row-start-2">
            {serviceLegend.map((item) => (
              <span key={item.category} className="flex items-center gap-1.5 capitalize">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                {item.category}
              </span>
            ))}
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-600" />No-show</span>
          </div>
        ) : null}
        <section className="min-h-[360px] rounded-card border border-border bg-white p-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-heading text-[17px] font-semibold text-heading">
                {selectedDate ? formatAppointmentDate(selectedDate) : "Select a date"}
              </h2>
              <p className="mt-1 text-[12px] text-muted">
                {selectedDate ? `${selectedAppointments.length} appointment${selectedAppointments.length === 1 ? "" : "s"}` : "Choose a calendar date to review bookings."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setLoadedMonth(null);
                setRefreshKey((current) => current + 1);
              }}
              disabled={loading}
              className="rounded-btn border border-border px-3 py-2 text-[12px] font-semibold text-slate hover:bg-page disabled:opacity-60"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {loading ? <p className="mt-6 text-[13px] text-muted">Loading appointments…</p> : null}
          {!loading && selectedDate && selectedAppointments.length === 0 ? (
            <p className="mt-6 rounded-lg bg-page p-4 text-[13px] text-muted">No appointments scheduled for this date.</p>
          ) : null}
          <div className="mt-4 space-y-3">
            {!loading && selectedAppointments.map((appointment) => (
              <article
                key={appointment.id}
                className={`rounded-lg border border-border border-l-4 p-4 ${
                  appointment.status === "no_show" ? "bg-red-50" : "bg-white"
                }`}
                style={{ borderLeftColor: appointment.status === "no_show" ? "#dc2626" : serviceColor(appointment.service.category) }}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{appointment.reference}</p>
                    <h3 className="mt-1 text-[14px] font-semibold text-heading">{appointment.patient.fullName}</h3>
                    <p className="text-[12px] text-muted">{appointment.patient.code} · {appointment.patient.phone || "No phone on file"}</p>
                  </div>
                  <span className={`rounded-pill px-3 py-1 text-[11px] font-semibold capitalize ${
                    appointment.status === "no_show" ? "bg-red-100 text-red-700" : "bg-page text-heading"
                  }`}>
                    {appointment.status.replace("_", " ")}
                  </span>
                </div>
                <div className="mt-3 grid gap-1 text-[12px] text-slate sm:grid-cols-2">
                  <p>{formatAppointmentTime(appointment.startTime)} – {formatAppointmentTime(appointment.endTime)}</p>
                  <p>
                    <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: serviceColor(appointment.service.category) }} />
                    {appointment.service.name} · {appointment.service.durationMin} min
                  </p>
                  <p>{appointment.dentist.name}</p>
                  <p>50% deposit: {appointment.payment.status.replace("_", " ")}{appointment.payment.depositAmountPhp ? ` · ${new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(appointment.payment.depositAmountPhp)}` : ""}</p>
                </div>
                {appointment.notes ? <p className="mt-3 rounded bg-page p-2 text-[12px] text-slate">Patient note: {appointment.notes}</p> : null}
                {appointment.status === "pending" ? (
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      disabled={updatingId === appointment.id}
                      onClick={() => void setStatus(appointment, "confirmed")}
                      className="rounded-btn bg-success px-3 py-2 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      disabled={updatingId === appointment.id}
                      onClick={() => void setStatus(appointment, "declined")}
                      className="rounded-btn border border-border px-3 py-2 text-[12px] font-semibold text-danger hover:bg-danger/5 disabled:opacity-60"
                    >
                      Decline
                    </button>
                  </div>
                ) : null}
                {appointment.status === "confirmed" ? (
                  <button
                    type="button"
                    disabled={updatingId === appointment.id}
                    onClick={() => void setStatus(appointment, "no_show")}
                    className="mt-3 rounded-btn border border-red-200 px-3 py-2 text-[12px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                  >
                    {updatingId === appointment.id ? "Updating…" : "Mark no-show"}
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
