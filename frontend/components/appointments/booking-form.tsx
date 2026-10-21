"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createAppointment,
  createSlotHold,
  formatAppointmentDate,
  formatAppointmentTime,
  getAvailabilityCalendar,
  getDayAvailability,
  getDentists,
  getPaymentConfig,
  getServices,
  subscribeToClinicCatalog,
  releaseSlotHold,
  startPaymentCheckout,
  type Dentist,
  type Service,
} from "@/lib/appointments";
import { MonthCalendar } from "@/components/ui/month-calendar";
import { PageHeader } from "@/components/ui/empty-state";

const STEPS = ["Service", "Dentist", "Date & time", "Review & payment"];

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function maxBookingDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  const date = new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 90);
  return date.toISOString().slice(0, 10);
}

function php(amount: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount);
}

function isOrthodontic(service?: Service) {
  return Boolean(service && /ortho|braces/i.test(`${service.name} ${service.category}`));
}

export function BookingForm() {
  const bookingMaxDate = maxBookingDate();
  const [services, setServices] = useState<Service[]>([]);
  const [dentists, setDentists] = useState<Dentist[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [dentistId, setDentistId] = useState("");
  const [step, setStep] = useState(0);
  const [month, setMonth] = useState(currentMonth);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [notes, setNotes] = useState("");
  const [calendarResult, setCalendarResult] = useState<{
    key: string;
    days: Record<string, { availableSlots: number }>;
  } | null>(null);
  const [slotResult, setSlotResult] = useState<{
    key: string;
    slots: Array<{ startTime: string; endTime: string; available: boolean }>;
  } | null>(null);
  const [paymentEnabled, setPaymentEnabled] = useState(false);
  const [paymentConfigMessage, setPaymentConfigMessage] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [calendarSettledKey, setCalendarSettledKey] = useState("");
  const [slotsSettledKey, setSlotsSettledKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const selectedService = useMemo(
    () => services.find((service) => String(service.id) === serviceId),
    [serviceId, services],
  );
  const allowedDentists = useMemo(
    () => isOrthodontic(selectedService)
      ? dentists.filter((dentist) => /petil/i.test(dentist.name))
      : dentists,
    [dentists, selectedService],
  );
  const selectedDentist = allowedDentists.find((dentist) => String(dentist.id) === dentistId)
    ?? allowedDentists[0];
  const selectedDentistId = selectedDentist ? String(selectedDentist.id) : "";
  const calendarKey = `${selectedDentistId}:${serviceId}:${month}`;
  const calendarData = calendarResult?.key === calendarKey ? calendarResult.days : {};
  const loadingCalendar = Boolean(serviceId && selectedDentistId && calendarSettledKey !== calendarKey);
  const slotKey = `${selectedDentistId}:${serviceId}:${selectedDate}`;
  const slots = slotResult?.key === slotKey ? slotResult.slots : [];
  const loadingSlots = Boolean(selectedDate && serviceId && selectedDentistId && slotsSettledKey !== slotKey);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getServices(), getDentists(), getPaymentConfig()])
      .then(([serviceResult, dentistResult, paymentConfig]) => {
        if (cancelled) return;
        setServices(serviceResult.items);
        setDentists(dentistResult.items);
        setServiceId(String(serviceResult.items[0]?.id ?? ""));
        setPaymentEnabled(paymentConfig.enabled);
        setPaymentConfigMessage(paymentConfig.message ?? "");
        setPaymentMethods(paymentConfig.paymentMethods);
        if (!paymentConfig.enabled) {
          setError(paymentConfig.message ?? "Online payment is not configured yet. Please contact the clinic to book.");
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Could not load booking options.");
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
        setError(requestError instanceof Error ? requestError.message : "Could not refresh booking options.");
      });
  }), []);

  useEffect(() => {
    if (!serviceId || !selectedDentistId) return;
    let cancelled = false;
    getAvailabilityCalendar(Number(selectedDentistId), Number(serviceId), month)
      .then((result) => {
        if (cancelled) return;
        setCalendarResult({
          key: `${selectedDentistId}:${serviceId}:${month}`,
          days: Object.fromEntries(result.days.map((day) => [day.date, { availableSlots: day.availableSlots }])),
        });
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Could not load calendar availability.");
      })
      .finally(() => {
        if (!cancelled) setCalendarSettledKey(calendarKey);
      });
    return () => {
      cancelled = true;
    };
  }, [calendarKey, month, selectedDentistId, serviceId]);

  useEffect(() => {
    if (!selectedDate || !serviceId || !selectedDentistId) return;
    let cancelled = false;
    getDayAvailability(Number(selectedDentistId), Number(serviceId), selectedDate)
      .then((result) => {
        if (!cancelled) {
          setSlotResult({
            key: `${selectedDentistId}:${serviceId}:${selectedDate}`,
            slots: result.slots,
          });
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Could not load available times.");
      })
      .finally(() => {
        if (!cancelled) setSlotsSettledKey(slotKey);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate, selectedDentistId, serviceId, slotKey]);

  function continueTo(nextStep: number) {
    setError("");
    if (nextStep === 1 && !selectedService) {
      setError("Choose a service to continue.");
      return;
    }
    if (nextStep === 2 && !selectedDentist) {
      setError(isOrthodontic(selectedService)
        ? "Doc Petil is not currently available in the dentist directory. Please contact the clinic."
        : "Choose a dentist to continue.");
      return;
    }
    if (nextStep === 3 && (!selectedDate || !selectedTime)) {
      setError("Choose an available date and time to continue.");
      return;
    }
    setStep(nextStep);
  }

  async function submitBooking(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paymentEnabled) {
      setError("Online payment is not configured yet. Please contact the clinic to book.");
      return;
    }
    if (!selectedService || !selectedDentist || !selectedDate || !selectedTime) {
      setError("Complete all booking steps before continuing to payment.");
      return;
    }

    setSubmitting(true);
    setError("");
    let holdId: number | undefined;
    try {
      const hold = await createSlotHold({
        serviceId: selectedService.id,
        dentistId: selectedDentist.id,
        date: selectedDate,
        startTime: selectedTime,
      });
      holdId = hold.id;
      const appointment = await createAppointment({
        serviceId: selectedService.id,
        dentistId: selectedDentist.id,
        date: selectedDate,
        startTime: selectedTime,
        notes: notes.trim() || undefined,
        holdId,
      });
      const payment = await startPaymentCheckout(appointment.id);
      window.location.assign(payment.checkoutUrl);
    } catch (requestError) {
      let message = requestError instanceof Error ? requestError.message : "Could not start your booking.";
      if (holdId) {
        try {
          await releaseSlotHold(holdId);
        } catch (releaseError) {
          const releaseMessage = releaseError instanceof Error ? releaseError.message : "Could not release the reserved time.";
          message = `${message} ${releaseMessage}`;
        }
      }
      setError(message);
      setSubmitting(false);
    }
  }

  function selectService(service: Service) {
    setServiceId(String(service.id));
    setDentistId("");
    setSelectedDate("");
    setSelectedTime("");
    setError("");
  }

  return (
    <div className="px-6 py-8 lg:px-8">
      <PageHeader
        kicker="Clinical Appointments & Scheduling"
        title="Book an Appointment"
        description="Complete the four steps. Your appointment is reserved once the 50% deposit is paid."
      />

      <ol className="mb-5 grid gap-2 sm:grid-cols-4" aria-label="Booking steps">
        {STEPS.map((label, index) => (
          <li key={label}>
            <button
              type="button"
              disabled={index > step}
              onClick={() => setStep(index)}
              className={`w-full rounded-lg border px-3 py-2.5 text-left text-[12px] font-semibold ${
                index === step
                  ? "border-primary bg-tint-2 text-primary"
                  : index < step
                    ? "border-border bg-white text-heading"
                    : "border-border bg-page text-muted"
              }`}
            >
              <span className="mr-2">{index + 1}.</span>{label}
            </button>
          </li>
        ))}
      </ol>

      <form onSubmit={submitBooking} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.7fr)]">
        <div className="min-w-0">
          {step === 0 ? (
            <section className="rounded-card border border-border bg-white p-5 shadow-card">
              <h2 className="font-heading text-[17px] font-semibold text-heading">1. Choose a service</h2>
              <p className="mb-4 mt-1 text-[12px] text-muted">Select one service for this appointment.</p>
              {loadingCatalog ? <p className="text-[13px] text-muted">Loading services…</p> : null}
              {!loadingCatalog && !services.length ? <p role="alert" className="text-[13px] text-danger">No services are currently available.</p> : null}
              <div className="grid gap-3 sm:grid-cols-2">
                {services.map((service) => {
                  const selected = String(service.id) === serviceId;
                  return (
                    <button
                      key={service.id}
                      type="button"
                      onClick={() => selectService(service)}
                      aria-pressed={selected}
                      className={`rounded-lg border p-4 text-left transition-colors ${
                        selected ? "border-primary bg-tint-2" : "border-border hover:border-primary"
                      }`}
                    >
                      <span className="block text-[14px] font-semibold text-heading">{service.name}</span>
                      <span className="mt-1 block text-[12px] text-muted">{service.category} · 60-minute appointment</span>
                      <span className="mt-2 block text-[14px] font-semibold text-primary">{php(service.pricePhp)}</span>
                    </button>
                  );
                })}
              </div>
              <button type="button" onClick={() => continueTo(1)} disabled={!selectedService} className="mt-5 rounded-btn bg-primary px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-60">
                Choose dentist
              </button>
            </section>
          ) : null}

          {step === 1 ? (
            <section className="rounded-card border border-border bg-white p-5 shadow-card">
              <h2 className="font-heading text-[17px] font-semibold text-heading">2. Choose a dentist</h2>
              <p className="mb-4 mt-1 text-[12px] text-muted">
                {isOrthodontic(selectedService)
                  ? "Orthodontic and braces services are available only with Doc Petil."
                  : "Choose any available dentist for this service."}
              </p>
              {allowedDentists.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {allowedDentists.map((dentist) => {
                    const selected = selectedDentistId === String(dentist.id);
                    return (
                      <button
                        key={dentist.id}
                        type="button"
                        onClick={() => {
                          setDentistId(String(dentist.id));
                          setSelectedDate("");
                          setSelectedTime("");
                        }}
                        aria-pressed={selected}
                        className={`rounded-lg border p-4 text-left ${
                          selected ? "border-primary bg-tint-2" : "border-border hover:border-primary"
                        }`}
                      >
                        <span className="block text-[14px] font-semibold text-heading">{dentist.name}</span>
                        <span className="mt-1 block text-[12px] text-muted">{dentist.specialty}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p role="alert" className="rounded-lg bg-warning/10 p-3 text-[13px] text-warning">
                  Doc Petil is not currently listed as an active dentist. Please contact the clinic to book this service.
                </p>
              )}
              <div className="mt-5 flex gap-2">
                <button type="button" onClick={() => setStep(0)} className="rounded-btn border border-border px-4 py-2.5 text-[13px] font-semibold text-slate">Back</button>
                <button type="button" onClick={() => continueTo(2)} disabled={!selectedDentist} className="rounded-btn bg-primary px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-60">Choose a time</button>
              </div>
            </section>
          ) : null}

          {step === 2 ? (
            <div className="space-y-5">
              <section className="rounded-card border border-border bg-white p-5 shadow-card">
                <div className="mb-4">
                  <h2 className="font-heading text-[17px] font-semibold text-heading">3. Choose a date</h2>
                  <p className="mt-1 text-[12px] text-muted">Only days with available times can be selected. Bookings are available up to 90 days ahead.</p>
                </div>
                {loadingCalendar ? <p className="mb-3 text-[12px] text-muted">Loading availability…</p> : null}
                <MonthCalendar
                  month={month}
                  selectedDate={selectedDate}
                  dayData={calendarData}
                  mode="availability"
                  maxDate={bookingMaxDate}
                  onMonthChange={(nextMonth) => {
                    setMonth(nextMonth);
                    setSelectedDate("");
                    setSelectedTime("");
                  }}
                  onSelectDate={(date) => {
                    setSelectedDate(date);
                    setSelectedTime("");
                    setError("");
                  }}
                />
              </section>

              <section className="rounded-card border border-border bg-white p-5 shadow-card">
                <h2 className="font-heading text-[16px] font-semibold text-heading">Available times</h2>
                {selectedDate ? <p className="mt-1 text-[12px] text-muted">{formatAppointmentDate(selectedDate)}</p> : <p className="mt-1 text-[12px] text-muted">Select an available date to see times.</p>}
                {loadingSlots ? <p className="mt-4 text-[12px] text-muted">Loading times…</p> : null}
                {!loadingSlots && selectedDate && slots.length === 0 ? <p className="mt-4 text-[12px] text-muted">No times are available on this date.</p> : null}
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {slots.map((slot) => (
                    <button
                      key={slot.startTime}
                      type="button"
                      disabled={!slot.available}
                      onClick={() => setSelectedTime(slot.startTime)}
                      className={`rounded-btn border px-3 py-2.5 text-[12px] font-semibold ${
                        selectedTime === slot.startTime
                          ? "border-primary bg-tint-2 text-primary"
                          : slot.available
                            ? "border-border text-heading hover:border-primary"
                            : "cursor-not-allowed border-border bg-page text-muted line-through"
                      }`}
                    >
                      {formatAppointmentTime(slot.startTime)}
                    </button>
                  ))}
                </div>
              </section>
              <div className="flex gap-2">
                <button type="button" onClick={() => setStep(1)} className="rounded-btn border border-border px-4 py-2.5 text-[13px] font-semibold text-slate">Back</button>
                <button type="button" onClick={() => continueTo(3)} disabled={!selectedDate || !selectedTime} className="rounded-btn bg-primary px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-60">Review & payment</button>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <section className="rounded-card border border-border bg-white p-5 shadow-card">
              <h2 className="font-heading text-[17px] font-semibold text-heading">4. Review & payment</h2>
              <p className="mt-1 text-[12px] text-muted">Pay 50% securely through PayMongo to submit the appointment request.</p>
              {selectedService && selectedDentist && selectedDate ? (
                <dl className="mt-5 divide-y divide-divider rounded-lg border border-border px-4">
                  <div className="flex justify-between gap-3 py-3 text-[13px]">
                    <dt className="text-muted">Service</dt><dd className="text-right font-semibold text-heading">{selectedService.name}</dd>
                  </div>
                  <div className="flex justify-between gap-3 py-3 text-[13px]">
                    <dt className="text-muted">Dentist</dt><dd className="text-right font-semibold text-heading">{selectedDentist.name}</dd>
                  </div>
                  <div className="flex justify-between gap-3 py-3 text-[13px]">
                    <dt className="text-muted">Date & time</dt><dd className="text-right font-semibold text-heading">{formatAppointmentDate(selectedDate)} · {formatAppointmentTime(selectedTime)}</dd>
                  </div>
                  <div className="flex justify-between gap-3 py-3 text-[13px]">
                    <dt className="text-muted">Total service amount</dt><dd className="font-semibold text-heading">{php(selectedService.pricePhp)}</dd>
                  </div>
                  <div className="flex justify-between gap-3 py-3 text-[13px]">
                    <dt className="font-semibold text-heading">Pay now (50%)</dt><dd className="font-bold text-primary">{php(selectedService.pricePhp / 2)}</dd>
                  </div>
                  <div className="flex justify-between gap-3 py-3 text-[13px]">
                    <dt className="text-muted">Remaining at the clinic</dt><dd className="font-semibold text-heading">{php(selectedService.pricePhp / 2)}</dd>
                  </div>
                </dl>
              ) : null}
              <label className="mt-5 block text-[12px] font-semibold text-heading">
                Notes for the clinic <span className="font-normal text-muted">(optional)</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  maxLength={500}
                  rows={4}
                  className="mt-2 block w-full resize-y rounded-btn border border-border px-3 py-2.5 text-[13px] font-normal text-heading outline-none focus:border-primary"
                  placeholder="Share any details that may help prepare for your visit."
                />
              </label>
              {!paymentEnabled ? <p role="alert" className="mt-4 rounded-lg bg-warning/10 p-3 text-[12px] text-warning">{paymentConfigMessage || "PayMongo is not configured. The clinic must add its payment keys before online bookings can be submitted."}</p> : null}
              {paymentEnabled ? <p className="mt-4 text-[11px] text-muted">Available checkout methods: {paymentMethods.map((method) => method === "paymaya" ? "Maya" : method === "grab_pay" ? "GrabPay" : method === "gcash" ? "GCash" : "Card").join(", ")}. Availability depends on the clinic’s PayMongo account.</p> : null}
              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" onClick={() => setStep(2)} className="rounded-btn border border-border px-4 py-2.5 text-[13px] font-semibold text-slate">Back</button>
                <button type="submit" disabled={submitting || !paymentEnabled} className="rounded-btn bg-primary px-4 py-2.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
                  {submitting ? "Opening secure checkout…" : `Pay ${selectedService ? php(selectedService.pricePhp / 2) : ""} & request appointment`}
                </button>
              </div>
            </section>
          ) : null}
        </div>

        <aside className="h-fit rounded-card border border-border bg-white p-5 shadow-card">
          <h2 className="font-heading text-[16px] font-semibold text-heading">Booking summary</h2>
          {error ? <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p> : null}
          {loadingCatalog ? <p className="mt-4 text-[12px] text-muted">Loading booking options…</p> : null}
          {!loadingCatalog && (!services.length || !dentists.length) ? <p className="mt-4 text-[12px] text-muted">No active services or dentists are currently available.</p> : null}
          <div className="mt-4 space-y-3 text-[13px]">
            <p><span className="text-muted">Service:</span> <span className="font-semibold text-heading">{selectedService?.name ?? "Not selected"}</span></p>
            <p><span className="text-muted">Dentist:</span> <span className="font-semibold text-heading">{selectedDentist?.name ?? (isOrthodontic(selectedService) ? "Doc Petil required" : "Not selected")}</span></p>
            <p><span className="text-muted">Visit:</span> <span className="font-semibold text-heading">{selectedDate && selectedTime ? `${formatAppointmentDate(selectedDate)} · ${formatAppointmentTime(selectedTime)}` : "Not selected"}</span></p>
            {selectedService ? (
              <>
                <hr className="border-divider" />
                <p><span className="text-muted">Total:</span> <span className="font-semibold text-heading">{php(selectedService.pricePhp)}</span></p>
                <p><span className="text-muted">50% online deposit:</span> <span className="font-semibold text-primary">{php(selectedService.pricePhp / 2)}</span></p>
                <p><span className="text-muted">Pay at clinic:</span> <span className="font-semibold text-heading">{php(selectedService.pricePhp / 2)}</span></p>
              </>
            ) : null}
          </div>
          <p className="mt-5 text-[11px] leading-relaxed text-muted">
            Your appointment request is confirmed only after PayMongo reports a successful deposit. Pay the remaining half directly to the dentist or clerk at the clinic.
          </p>
        </aside>
      </form>
    </div>
  );
}
