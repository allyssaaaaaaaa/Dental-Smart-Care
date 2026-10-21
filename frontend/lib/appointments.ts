export type Service = {
  id: number;
  name: string;
  category: string;
  description: string;
  pricePhp: number;
  durationMin: number;
  prepGuidelines: string;
  active?: boolean;
};

export type Dentist = {
  id: number;
  name: string;
  specialty: string;
  status: string;
  bio?: string;
  active?: boolean;
  ratingAverage?: number | null;
  reviewCount?: number;
  reviews?: Array<{ rating: number; comment: string; createdAt: string }>;
};

export type PatientReview = {
  rating: number;
  comment: string;
  isPublic: boolean;
  createdAt: string;
};

export type Appointment = {
  id: number;
  reference: string;
  status: "pending" | "confirmed" | "declined" | "cancelled" | "completed" | "no_show";
  source: string;
  date: string;
  startTime: string;
  endTime: string;
  notes: string | null;
  statusReason: string | null;
  patient: { id: number; code: string; fullName: string; phone: string | null; hasAccount: boolean };
  dentist: { id: number; name: string; specialty: string };
  service: { id: number; name: string; category: string; pricePhp: number; durationMin: number };
  payment: { status: string; depositAmountPhp: number; amountPaidPhp?: number };
  patientReview?: PatientReview | null;
  createdAt: string;
};

type ApiError = {
  error?: {
    message?: string;
    details?: Record<string, string>;
  };
};

export type AdminInsights = {
  range: { from: string; to: string };
  kpis: {
    appointments: number;
    completedRevenuePhp: number;
    cancellationRatePct: number;
    noShowRiskCount: number;
  };
  servicePerformance: Array<{
    serviceId: number;
    name: string;
    category: string;
    bookings: number;
    completed: number;
    cancelled: number;
    revenuePhp: number;
  }>;
  cancellationSlots: Array<{
    time: string;
    total: number;
    cancelled: number;
    cancellationRatePct: number;
  }>;
  demographics: Array<{ category: string; ageBand: string; sex: string; appointments: number }>;
  paymentAudit: {
    onlineBookings: number;
    onlineDepositsPaid: number;
    onlineDepositsPending: number;
    onlineDepositExpectedPhp: number;
    depositsReceivedPhp: number;
    onlineBookingValuePhp: number;
    clinicBalanceExpectedPhp: number;
    counterBalanceSettledPhp: number;
    counterBalanceUnrecordedPhp: number;
    counterSettlementsTracked: boolean;
    counterPayments: Array<{
      appointmentId: number;
      patientName: string;
      date: string;
      service: string;
      amountDuePhp: number;
      settledPhp: number;
      status: "settled" | "unrecorded";
    }>;
  };
  demandForecast: {
    days: Array<{ date: string; predictedBookings: number }>;
    predictedTotal: number;
    changePct: number;
  };
  revenueProjection: {
    month: string;
    confirmedBookings: number;
    projectedRevenuePhp: number;
    confirmedDepositsPhp: number;
    clinicBalanceExpectedPhp: number;
  };
  noShowRisk: Array<{
    appointmentId: number;
    patientName: string;
    date: string;
    startTime: string;
    service: string;
    score: number;
    level: "low" | "medium" | "high";
    reason: string;
  }>;
  supplyForecast: Array<{ category: string; service: string; appointments: number }>;
};

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (response.status === 204) return undefined as T;

  const result = (await response.json()) as T & ApiError;
  if (!response.ok) {
    const message = result.error?.message ?? "The request could not be completed.";
    const details = result.error?.details ? Object.values(result.error.details).join(". ") : "";
    throw new Error(details ? `${message}: ${details}` : message);
  }
  return result;
}

export function getAdminInsights(from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return apiRequest<AdminInsights>(`/api/admin/insights${params.size ? `?${params}` : ""}`);
}

export function recordClinicSettlement(appointmentId: number) {
  return apiRequest<{ appointmentId: number; amountPhp: number; status: "settled" }>(
    `/api/admin/appointments/${appointmentId}/settlement`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export function getServices(includeInactive = false) {
  return apiRequest<{ items: Service[] }>(`/api/services${includeInactive ? "?includeInactive=1" : ""}`);
}

export function getDentists(includeInactive = false) {
  return apiRequest<{ items: Dentist[] }>(`/api/dentists${includeInactive ? "?includeInactive=1" : ""}`);
}

export function createClinicService(data: Omit<Service, "id" | "active">) {
  return apiRequest<Service>("/api/services", { method: "POST", body: JSON.stringify(data) });
}

export function updateClinicService(id: number, data: Partial<Omit<Service, "id">>) {
  return apiRequest<Service>(`/api/services/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteClinicService(id: number) {
  return apiRequest<void>(`/api/services/${id}`, { method: "DELETE" });
}

export function createClinicDentist(data: { fullName: string; specialty: string; bio: string }) {
  return apiRequest<Dentist>("/api/dentists", { method: "POST", body: JSON.stringify(data) });
}

export function updateClinicDentist(id: number, data: Partial<{ fullName: string; specialty: string; bio: string; active: boolean }>) {
  return apiRequest<Dentist>(`/api/dentists/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function deleteClinicDentist(id: number) {
  return apiRequest<void>(`/api/dentists/${id}`, { method: "DELETE" });
}

export function submitAppointmentReview(
  appointmentId: number,
  data: { rating: number; comment: string; isPublic: boolean },
) {
  return apiRequest<{
    id: number;
    dentistId: number;
    rating: number;
    comment: string;
    isPublic: boolean;
    createdAt: string;
  }>(`/api/appointments/${appointmentId}/review`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function subscribeToClinicCatalog(onUpdate: () => void) {
  const stream = new EventSource("/api/stream", { withCredentials: true });
  stream.addEventListener("clinic.catalog.updated", onUpdate);
  return () => {
    stream.removeEventListener("clinic.catalog.updated", onUpdate);
    stream.close();
  };
}

export function subscribeToPublicClinicCatalog(onUpdate: () => void) {
  const stream = new EventSource("/api/catalog/stream");
  stream.addEventListener("clinic.catalog.updated", onUpdate);
  stream.addEventListener("dentist.review.updated", onUpdate);
  return () => {
    stream.removeEventListener("clinic.catalog.updated", onUpdate);
    stream.removeEventListener("dentist.review.updated", onUpdate);
    stream.close();
  };
}

export function getAvailabilityCalendar(dentistId: number, serviceId: number, month: string) {
  return apiRequest<{
    days: Array<{ date: string; dayStatus: string; availableSlots: number }>;
  }>(`/api/dentists/${dentistId}/availability/calendar?month=${month}&serviceId=${serviceId}`);
}

export function getDayAvailability(dentistId: number, serviceId: number, date: string) {
  return apiRequest<{
    dayStatus: string;
    slots: Array<{ startTime: string; endTime: string; available: boolean; reason?: string }>;
  }>(`/api/dentists/${dentistId}/availability?date=${date}&serviceId=${serviceId}`);
}

export function getAppointments(query: string) {
  return apiRequest<{ items: Appointment[]; total: number; page: number; pageSize: number }>(
    `/api/appointments?${query}`,
  );
}

export type PatientProfile = {
  id: number;
  code: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  medicalNotes?: string | null;
};

export function searchPatients(query: string) {
  return apiRequest<{ items: PatientProfile[]; total: number }>(
    `/api/patients?q=${encodeURIComponent(query)}&pageSize=20`,
  );
}

export function getDentistNotes(patientId: number) {
  return apiRequest<{ patientId: number; notes: string }>(`/api/patients/${patientId}/dentist-notes`);
}

export function saveDentistNotes(patientId: number, notes: string) {
  return apiRequest<{ patientId: number; notes: string }>(`/api/patients/${patientId}/dentist-notes`, {
    method: "PATCH",
    body: JSON.stringify({ notes }),
  });
}

export type DentistPatientNote = {
  id: number;
  patientId: number;
  createdBy: number;
  body: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export function getDentistPatientNotes(patientId: number) {
  return apiRequest<{ patientId: number; items: DentistPatientNote[] }>(`/api/patients/${patientId}/dentist-notes/entries`);
}

export function createDentistPatientNote(patientId: number, body: string) {
  return apiRequest<DentistPatientNote>(`/api/patients/${patientId}/dentist-notes/entries`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function updateDentistPatientNote(patientId: number, noteId: number, body: string) {
  return apiRequest<DentistPatientNote>(`/api/patients/${patientId}/dentist-notes/entries/${noteId}`, {
    method: "PATCH",
    body: JSON.stringify({ body }),
  });
}

export function deleteDentistPatientNote(patientId: number, noteId: number) {
  return apiRequest<{ deleted: boolean }>(`/api/patients/${patientId}/dentist-notes/entries/${noteId}`, {
    method: "DELETE",
  });
}

export function createPatientProfile(input: {
  fullName: string;
  birthDate: string;
  sex: "female" | "male" | "other";
  phone?: string;
  email?: string;
}) {
  return apiRequest<PatientProfile>("/api/patients", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getPaymentConfig() {
  return apiRequest<{
    enabled: boolean;
    depositPercent: number;
    paymentMethods: string[];
    message?: string;
  }>("/api/payments/config");
}

export function startPaymentCheckout(appointmentId: number, totalServiceAmount?: number) {
  return apiRequest<{
    appointmentId: number;
    status: string;
    depositAmountPhp: number;
    remainingAmountPhp: number;
    checkoutUrl: string;
  }>("/create-checkout-session", {
    method: "POST",
    body: JSON.stringify({ appointmentId, ...(totalServiceAmount !== undefined ? { totalServiceAmount } : {}) }),
  });
}

export function verifyAppointmentPayment(appointmentId: number) {
  return apiRequest<{
    appointmentId: number;
    status: string;
    paymentStatus: string;
    bookingStatus: Appointment["status"];
    depositAmountPhp: number;
    remainingAmountPhp: number;
    paymentId: string | null;
    amountPaidPhp: number;
    checkoutUrl: string;
  }>(`/api/payments/${appointmentId}`);
}

export function createSlotHold(input: {
  serviceId: number;
  dentistId: number;
  date: string;
  startTime: string;
}) {
  return apiRequest<{ id: number }>("/api/slot-holds", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function releaseSlotHold(id: number) {
  return apiRequest<void>(`/api/slot-holds/${id}`, { method: "DELETE" });
}

export async function sendConversationImage(conversationId: number, file: File) {
  const imageDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read this image."));
    reader.onerror = () => reject(new Error("Could not read this image."));
    reader.readAsDataURL(file);
  });
  const comma = imageDataUrl.indexOf(",");
  if (comma < 0) throw new Error("Could not encode this image.");
  return apiRequest(`/api/conversations/${conversationId}/images`, {
    method: "POST",
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      imageBase64: imageDataUrl.slice(comma + 1),
    }),
  });
}

export function createAppointment(input: {
  serviceId: number;
  dentistId: number;
  date: string;
  startTime: string;
  notes?: string;
  holdId?: number;
  patientId?: number;
  source?: "walk_in" | "messenger";
}) {
  return apiRequest<Appointment>("/api/appointments", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAppointmentStatus(id: number, status: "confirmed" | "declined" | "cancelled" | "no_show") {
  return apiRequest<Appointment>(`/api/appointments/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

const SERVICE_COLORS: Record<string, string> = {
  preventive: "#0f9f75",
  diagnostic: "#0284c7",
  restorative: "#d97706",
  surgery: "#e11d48",
  endodontics: "#7c3aed",
  cosmetic: "#c026d3",
  orthodontics: "#4f46e5",
  general: "#2563eb",
};

export function serviceColor(category: string) {
  return SERVICE_COLORS[category.toLowerCase()] ?? "#475569";
}

export function formatAppointmentDate(date: string, options?: Intl.DateTimeFormatOptions) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-PH", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    ...options,
  });
}

export function formatAppointmentTime(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  });
}
