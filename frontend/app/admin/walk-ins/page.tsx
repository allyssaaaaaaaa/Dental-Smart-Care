"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/empty-state";
import {
  createAppointment,
  createPatientProfile,
  formatAppointmentDate,
  formatAppointmentTime,
  getDayAvailability,
  getDentists,
  getServices,
  searchPatients,
  subscribeToClinicCatalog,
  type Appointment,
  type Dentist,
  type PatientProfile,
  type Service,
} from "@/lib/appointments";

function clinicToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function isOrthodontic(service?: Service) {
  return Boolean(service && /ortho|braces/i.test(`${service.name} ${service.category}`));
}

function php(amount: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount);
}

export default function WalkInBookingPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [dentists, setDentists] = useState<Dentist[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [dentistId, setDentistId] = useState("");
  const [date, setDate] = useState(clinicToday);
  const [time, setTime] = useState("");
  const [slots, setSlots] = useState<Array<{ startTime: string; endTime: string; available: boolean }>>([]);
  const [availabilityKey, setAvailabilityKey] = useState("");
  const [availabilityRefresh, setAvailabilityRefresh] = useState(0);
  const [search, setSearch] = useState("");
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientProfile | null>(null);
  const [newPatient, setNewPatient] = useState(false);
  const [fullName, setFullName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [sex, setSex] = useState<"female" | "male" | "other">("female");
  const [email, setEmail] = useState("");
  const [bookingNotes, setBookingNotes] = useState("");
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [createdAppointment, setCreatedAppointment] = useState<Appointment | null>(null);

  const service = services.find((item) => String(item.id) === serviceId);
  const allowedDentists = useMemo(
    () => isOrthodontic(service) ? dentists.filter((dentist) => /petil/i.test(dentist.name)) : dentists,
    [dentists, service],
  );
  const dentist = allowedDentists.find((item) => String(item.id) === dentistId) ?? allowedDentists[0];
  const currentAvailabilityKey = `${dentist?.id ?? ""}:${serviceId}:${date}`;
  const loadingAvailability = Boolean(serviceId && dentist && availabilityKey !== currentAvailabilityKey);
  const visiblePatients = search.trim().length < 2 || selectedPatient ? [] : patients;

  useEffect(() => {
    const interval = window.setInterval(() => {
      const today = clinicToday();
      if (date < today) setDate(today);
      else if (date === today) setAvailabilityRefresh((current) => current + 1);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [date]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getServices(), getDentists()])
      .then(([serviceResult, dentistResult]) => {
        if (cancelled) return;
        setServices(serviceResult.items);
        setDentists(dentistResult.items);
        setServiceId(String(serviceResult.items[0]?.id ?? ""));
        setDentistId(String(dentistResult.items[0]?.id ?? ""));
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Could not load walk-in booking options.");
      })
      .finally(() => {
        if (!cancelled) setLoadingCatalog(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => subscribeToClinicCatalog(() => {
    Promise.all([getServices(), getDentists()])
      .then(([serviceResult, dentistResult]) => {
        setServices(serviceResult.items);
        setDentists(dentistResult.items);
        setServiceId((current) =>
          serviceResult.items.some((item) => String(item.id) === current)
            ? current
            : String(serviceResult.items[0]?.id ?? ""),
        );
        setDentistId((current) =>
          dentistResult.items.some((item) => String(item.id) === current)
            ? current
            : String(dentistResult.items[0]?.id ?? ""),
        );
      })
      .catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : "Could not refresh walk-in booking options.");
      });
  }), []);

  useEffect(() => {
    if (search.trim().length < 2 || selectedPatient) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoadingPatients(true);
      searchPatients(search.trim())
        .then((result) => {
          if (!cancelled) setPatients(result.items);
        })
        .catch((requestError: unknown) => {
          if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Could not search patient records.");
        })
        .finally(() => {
          if (!cancelled) setLoadingPatients(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search, selectedPatient]);

  useEffect(() => {
    if (!serviceId || !dentist || !date) return;
    let cancelled = false;
    getDayAvailability(dentist.id, Number(serviceId), date)
      .then((result) => {
        if (cancelled) return;
        setSlots(result.slots);
        setTime((current) =>
          current && !result.slots.some((slot) => slot.startTime === current && slot.available)
            ? ""
            : current,
        );
        setAvailabilityKey(currentAvailabilityKey);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setSlots([]);
          setTime("");
          setAvailabilityKey(currentAvailabilityKey);
          setError(requestError instanceof Error ? requestError.message : "Could not load available one-hour times.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [availabilityRefresh, currentAvailabilityKey, date, dentist, serviceId]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!service || !dentist || !date || !time) {
      setError("Choose a service, dentist, date, and available one-hour time.");
      return;
    }
    setSubmitting(true);
    try {
      const patient = selectedPatient ?? await createPatientProfile({
        fullName,
        birthDate,
        sex,
        email: email.trim() || undefined,
      });
      setSelectedPatient(patient);
      setNewPatient(false);
      setPatients([]);
      const appointment = await createAppointment({
        patientId: patient.id,
        serviceId: service.id,
        dentistId: dentist.id,
        date,
        startTime: time,
        source: "walk_in",
        notes: bookingNotes.trim() || undefined,
      });
      setCreatedAppointment(appointment);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not book the walk-in appointment.");
    } finally {
      setSubmitting(false);
    }
  }

  if (createdAppointment) {
    return (
      <div className="px-6 py-8 lg:px-8">
        <PageHeader title="Walk-in booked" description="The appointment has been added to the clinic calendar." />
        <section className="max-w-2xl rounded-card border border-border bg-white p-6 shadow-card">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-success">{createdAppointment.reference} · Confirmed</p>
          <h2 className="mt-2 font-heading text-[20px] font-bold text-heading">{createdAppointment.patient.fullName}</h2>
          <p className="mt-2 text-[14px] text-slate">{createdAppointment.service.name} with {createdAppointment.dentist.name}</p>
          <p className="mt-1 text-[13px] text-muted">
            {formatAppointmentDate(createdAppointment.date)} · {formatAppointmentTime(createdAppointment.startTime)} – {formatAppointmentTime(createdAppointment.endTime)}
          </p>
          <Link href="/admin/schedule" className="mt-5 inline-flex rounded-btn bg-primary px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-primary/90">
            View appointment calendar
          </Link>
          <button
            type="button"
            onClick={() => {
              setCreatedAppointment(null);
              setSelectedPatient(null);
              setSearch("");
              setTime("");
            }}
            className="ml-3 mt-5 rounded-btn border border-border px-4 py-2.5 text-[13px] font-semibold text-slate"
          >
            Book another walk-in
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="px-6 py-8 lg:px-8">
      <PageHeader
        title="Walk-in Booking"
        description="Find or add the patient, choose a service, and reserve a one-hour visit."
      />
      <form onSubmit={submit} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <section className="rounded-card border border-border bg-white p-5 shadow-card">
            <h2 className="font-heading text-[17px] font-semibold text-heading">1. Patient details</h2>
            {selectedPatient ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-tint-2 p-4">
                <div>
                  <p className="text-[14px] font-semibold text-heading">{selectedPatient.fullName}</p>
                  <p className="mt-1 text-[12px] text-muted">{selectedPatient.code} · {selectedPatient.phone ?? "No phone on file"}</p>
                </div>
                <button type="button" onClick={() => setSelectedPatient(null)} className="text-[12px] font-semibold text-primary hover:underline">Change patient</button>
              </div>
            ) : (
              <>
                <div className="mt-4 flex gap-2">
                  <button type="button" onClick={() => setNewPatient(false)} className={`rounded-btn px-3 py-2 text-[12px] font-semibold ${!newPatient ? "bg-primary text-white" : "border border-border text-slate"}`}>Existing patient</button>
                  <button type="button" onClick={() => setNewPatient(true)} className={`rounded-btn px-3 py-2 text-[12px] font-semibold ${newPatient ? "bg-primary text-white" : "border border-border text-slate"}`}>New walk-in</button>
                </div>
                {!newPatient ? (
                  <div className="mt-4">
                    <label htmlFor="patient-search" className="text-[12px] font-semibold text-heading">Search name, patient code, phone, or email</label>
                    <input
                      id="patient-search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      className="mt-2 w-full rounded-btn border border-border px-3 py-2.5 text-[13px] outline-none focus:border-primary"
                      placeholder="Enter at least 2 characters"
                    />
                    {loadingPatients ? <p className="mt-2 text-[12px] text-muted">Searching patients…</p> : null}
                    {visiblePatients.length ? (
                      <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-border">
                        {visiblePatients.map((patient) => (
                          <button key={patient.id} type="button" onClick={() => setSelectedPatient(patient)} className="block w-full border-b border-divider px-3 py-2.5 text-left last:border-0 hover:bg-page">
                            <span className="block text-[13px] font-semibold text-heading">{patient.fullName} · {patient.code}</span>
                            <span className="mt-0.5 block text-[11px] text-muted">{patient.phone ?? patient.email ?? "No contact details"}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {!loadingPatients && search.trim().length >= 2 && !visiblePatients.length ? <p className="mt-2 text-[12px] text-muted">No matching patient found. Use “New walk-in” to create a profile.</p> : null}
                  </div>
                ) : (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="text-[12px] font-semibold text-heading sm:col-span-2">Full name
                      <input required minLength={2} maxLength={120} value={fullName} onChange={(event) => setFullName(event.target.value)} className="mt-1.5 w-full rounded-btn border border-border px-3 py-2.5 text-[13px] font-normal outline-none focus:border-primary" />
                    </label>
                    <label className="text-[12px] font-semibold text-heading">Birth date
                      <input required type="date" max={clinicToday()} value={birthDate} onChange={(event) => setBirthDate(event.target.value)} className="mt-1.5 w-full rounded-btn border border-border px-3 py-2.5 text-[13px] font-normal outline-none focus:border-primary" />
                    </label>
                    <label className="text-[12px] font-semibold text-heading">Sex
                      <select value={sex} onChange={(event) => setSex(event.target.value as typeof sex)} className="mt-1.5 w-full rounded-btn border border-border bg-white px-3 py-2.5 text-[13px] font-normal outline-none focus:border-primary">
                        <option value="female">Female</option><option value="male">Male</option><option value="other">Other</option>
                      </select>
                    </label>
                    <label className="text-[12px] font-semibold text-heading">Email <span className="font-normal text-muted">(optional)</span>
                      <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-btn border border-border px-3 py-2.5 text-[13px] font-normal outline-none focus:border-primary" />
                    </label>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="rounded-card border border-border bg-white p-5 shadow-card">
            <h2 className="font-heading text-[17px] font-semibold text-heading">2. Appointment details</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-[12px] font-semibold text-heading">Service
                <select value={serviceId} onChange={(event) => { setServiceId(event.target.value); setTime(""); }} disabled={loadingCatalog} className="mt-1.5 w-full rounded-btn border border-border bg-white px-3 py-2.5 text-[13px] font-normal outline-none focus:border-primary">
                  {services.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="text-[12px] font-semibold text-heading">Dentist
                <select value={dentist?.id ?? ""} onChange={(event) => { setDentistId(event.target.value); setTime(""); }} disabled={loadingCatalog || !allowedDentists.length} className="mt-1.5 w-full rounded-btn border border-border bg-white px-3 py-2.5 text-[13px] font-normal outline-none focus:border-primary">
                  {allowedDentists.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="text-[12px] font-semibold text-heading sm:col-span-2">Date
                <input required type="date" min={clinicToday()} value={date} onChange={(event) => { setDate(event.target.value); setTime(""); }} className="mt-1.5 w-full rounded-btn border border-border px-3 py-2.5 text-[13px] font-normal outline-none focus:border-primary" />
              </label>
              <label className="text-[12px] font-semibold text-heading sm:col-span-2">Notes for this booking <span className="font-normal text-muted">(optional)</span>
                <textarea value={bookingNotes} onChange={(event) => setBookingNotes(event.target.value)} maxLength={500} rows={3} placeholder="Add details to help prepare for this patient's visit." className="mt-1.5 w-full resize-y rounded-btn border border-border px-3 py-2.5 text-[13px] font-normal outline-none focus:border-primary" />
              </label>
            </div>
            {isOrthodontic(service) && !allowedDentists.length ? <p className="mt-3 text-[12px] text-danger">Doc Petil is not currently active; this service cannot be booked.</p> : null}
            <h3 className="mt-5 text-[13px] font-semibold text-heading">Available one-hour times</h3>
            {date === clinicToday() ? <p className="mt-1 text-[11px] text-muted">Today’s availability refreshes automatically every 30 seconds.</p> : null}
            {loadingAvailability ? <p className="mt-2 text-[12px] text-muted">Checking the calendar…</p> : null}
            {!loadingAvailability && !slots.some((slot) => slot.available) ? <p className="mt-2 text-[12px] text-muted">No one-hour times are available on this date.</p> : null}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {slots.map((slot) => (
                <button key={slot.startTime} type="button" disabled={!slot.available} onClick={() => setTime(slot.startTime)} className={`rounded-btn border px-3 py-2.5 text-[12px] font-semibold ${time === slot.startTime ? "border-primary bg-tint-2 text-primary" : slot.available ? "border-border text-heading hover:border-primary" : "cursor-not-allowed bg-page text-muted line-through"}`}>
                  {formatAppointmentTime(slot.startTime)} – {formatAppointmentTime(slot.endTime)}
                </button>
              ))}
            </div>
          </section>
        </div>

        <aside className="h-fit rounded-card border border-border bg-white p-5 shadow-card">
          <h2 className="font-heading text-[16px] font-semibold text-heading">Walk-in summary</h2>
          <p className="mt-3 text-[13px]"><span className="text-muted">Patient:</span> <span className="font-semibold text-heading">{selectedPatient?.fullName ?? (newPatient ? fullName || "New walk-in" : "Select a patient")}</span></p>
          <p className="mt-2 text-[13px]"><span className="text-muted">Service:</span> <span className="font-semibold text-heading">{service?.name ?? "Select a service"}</span></p>
          <p className="mt-2 text-[13px]"><span className="text-muted">Dentist:</span> <span className="font-semibold text-heading">{dentist?.name ?? "Select a dentist"}</span></p>
          <p className="mt-2 text-[13px]"><span className="text-muted">Time:</span> <span className="font-semibold text-heading">{date && time ? `${formatAppointmentDate(date)} · ${formatAppointmentTime(time)} – ${formatAppointmentTime(`${String(Number(time.slice(0, 2)) + 1).padStart(2, "0")}:00`)}` : "Choose an available time"}</span></p>
          {service ? <p className="mt-2 text-[13px]"><span className="text-muted">Clinic charge:</span> <span className="font-semibold text-heading">{php(service.pricePhp)}</span></p> : null}
          {error ? <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p> : null}
          <p className="mt-4 text-[11px] leading-relaxed text-muted">Walk-in bookings are confirmed immediately and appear in the admin calendar. Payment is collected at the clinic.</p>
          <button type="submit" disabled={submitting || loadingCatalog || !service || !dentist || !time || (!selectedPatient && !newPatient)} className="mt-5 w-full rounded-btn bg-primary px-4 py-3 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
            {submitting ? "Saving walk-in…" : "Confirm walk-in booking"}
          </button>
        </aside>
      </form>
    </div>
  );
}
