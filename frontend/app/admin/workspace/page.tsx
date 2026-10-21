"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/ui/empty-state";
import {
  createDentistPatientNote,
  deleteDentistPatientNote,
  getAppointments,
  getDentistPatientNotes,
  searchPatients,
  updateDentistPatientNote,
  type Appointment,
  type DentistPatientNote,
  type PatientProfile,
} from "@/lib/appointments";

export default function WorkspacePage() {
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientProfile | null>(null);
  const [notes, setNotes] = useState<DentistPatientNote[]>([]);
  const [draft, setDraft] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const noteRequest = useRef(0);

  const refreshNotes = useCallback(async (patientId: number) => {
    const result = await getDentistPatientNotes(patientId);
    setNotes(result.items);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoadingPatients(true);
      searchPatients(query.trim())
        .then((result) => {
          if (!cancelled) {
            setPatients(result.items);
            setError("");
          }
        })
        .catch((requestError: unknown) => {
          if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Could not load patient records.");
        })
        .finally(() => {
          if (!cancelled) setLoadingPatients(false);
        });
    }, query ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  async function selectPatient(patient: PatientProfile) {
    if (selectedPatient?.id === patient.id) return;
    noteRequest.current += 1;
    const requestId = noteRequest.current;
    setSelectedPatient(patient);
    setNotes([]);
    setDraft("");
    setEditingNoteId(null);
    setAppointments([]);
    setError("");
    setSaved(false);
    setLoadingNotes(true);
    setLoadingAppointments(true);
    try {
      const [notesResult, appointmentResult] = await Promise.all([
        getDentistPatientNotes(patient.id),
        getAppointments(`patientId=${patient.id}&page=1&pageSize=100&order=desc`),
      ]);
      if (noteRequest.current === requestId) {
        setNotes(notesResult.items);
        setAppointments(appointmentResult.items);
      }
    } catch (requestError) {
      if (noteRequest.current === requestId) {
        setError(requestError instanceof Error ? requestError.message : "Could not load this patient's notes.");
      }
    } finally {
      if (noteRequest.current === requestId) {
        setLoadingNotes(false);
        setLoadingAppointments(false);
      }
    }
  }

  async function saveNotes() {
    if (!selectedPatient) return;
    const body = draft.trim();
    if (!body) {
      setError("Enter a note before saving.");
      return;
    }
    setSavingNote(true);
    setError("");
    setSaved(false);
    try {
      if (editingNoteId === null) {
        await createDentistPatientNote(selectedPatient.id, body);
      } else {
        await updateDentistPatientNote(selectedPatient.id, editingNoteId, body);
      }
      await refreshNotes(selectedPatient.id);
      setDraft("");
      setEditingNoteId(null);
      setSaved(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not save dentist notes.");
    } finally {
      setSavingNote(false);
    }
  }

  async function removeNote(noteId: number) {
    if (!selectedPatient || !window.confirm("Delete this dentist note? This cannot be undone.")) return;
    setDeletingNoteId(noteId);
    setError("");
    setSaved(false);
    try {
      await deleteDentistPatientNote(selectedPatient.id, noteId);
      setNotes((current) => current.filter((note) => note.id !== noteId));
      if (editingNoteId === noteId) {
        setEditingNoteId(null);
        setDraft("");
      }
      setSaved(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not delete this dentist note.");
    } finally {
      setDeletingNoteId(null);
    }
  }

  useEffect(() => {
    if (!selectedPatient) return;
    const patientId = selectedPatient.id;
    const stream = new EventSource("/api/stream", { withCredentials: true });
    const onNoteUpdated = (event: Event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as { patientId?: number };
        if (payload.patientId === patientId) {
          void refreshNotes(patientId).catch((requestError: unknown) => {
            setError(requestError instanceof Error ? requestError.message : "Could not refresh shared dentist notes.");
          });
        }
      } catch {
        setError("Received an invalid dentist note update.");
      }
    };
    stream.addEventListener("dentist.note.updated", onNoteUpdated);
    return () => {
      stream.removeEventListener("dentist.note.updated", onNoteUpdated);
      stream.close();
    };
  }, [refreshNotes, selectedPatient]);

  return (
    <div className="px-6 py-8 lg:px-8">
      <PageHeader
        title="Clinical Workspace"
        description="Private dentist notes for each patient. These notes are visible only in the admin dentist portal."
      />
      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.6fr)]">
        <section className="rounded-card border border-border bg-white p-5 shadow-card">
          <h2 className="font-heading text-[17px] font-semibold text-heading">Patient records</h2>
          <label className="mt-4 block text-[12px] font-semibold text-heading">
            Search patients
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, patient code, phone, or email"
              className="mt-1.5 w-full rounded-btn border border-border px-3 py-2.5 text-[13px] font-normal outline-none focus:border-primary"
            />
          </label>
          {loadingPatients ? <p className="mt-4 text-[12px] text-muted">Loading patient records…</p> : null}
          {!loadingPatients && patients.length === 0 ? <p className="mt-4 text-[12px] text-muted">No patients found.</p> : null}
          <div className="mt-3 max-h-[520px] space-y-2 overflow-y-auto">
            {patients.map((patient) => (
              <button
                key={patient.id}
                type="button"
                onClick={() => { void selectPatient(patient); }}
                className={`w-full rounded-btn border px-3 py-3 text-left ${selectedPatient?.id === patient.id ? "border-primary bg-tint-2" : "border-border hover:border-primary"}`}
              >
                <span className="block text-[13px] font-semibold text-heading">{patient.fullName}</span>
                <span className="mt-1 block text-[11px] text-muted">{patient.code}{patient.phone ? ` · ${patient.phone}` : ""}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-card border border-border bg-white p-5 shadow-card">
          <h2 className="font-heading text-[17px] font-semibold text-heading">Dentist notes</h2>
          {selectedPatient ? (
            <>
              <p className="mt-2 text-[13px] text-muted">{selectedPatient.fullName} · {selectedPatient.code}</p>
              <label className="mt-5 block text-[12px] font-semibold text-heading">
                {editingNoteId === null ? "New private clinical note" : "Edit private clinical note"}
                <textarea
                  value={draft}
                  onChange={(event) => { setDraft(event.target.value); setSaved(false); }}
                  disabled={loadingNotes}
                  maxLength={5000}
                  rows={5}
                  placeholder="Record relevant clinical observations and follow-up details."
                  className="mt-1.5 w-full resize-y rounded-btn border border-border px-3 py-2.5 text-[13px] font-normal outline-none focus:border-primary disabled:bg-page"
                />
              </label>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-[11px] text-muted">{draft.length}/5000 characters</span>
                <button
                  type="button"
                  onClick={() => void saveNotes()}
                  disabled={loadingNotes || savingNote || !draft.trim()}
                  className="rounded-btn bg-primary px-4 py-2.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingNote ? "Saving…" : editingNoteId === null ? "Save note" : "Save changes"}
                </button>
              </div>
              {editingNoteId !== null ? <button type="button" onClick={() => { setEditingNoteId(null); setDraft(""); }} className="mt-2 text-[11px] font-semibold text-muted underline">Cancel editing</button> : null}
              <div className="mt-6 border-t border-border pt-4">
                <h3 className="text-[13px] font-semibold text-heading">Saved dentist notes <span className="font-normal text-muted">({notes.length})</span></h3>
                {loadingNotes ? <p className="mt-3 text-[12px] text-muted">Loading saved notes…</p> : null}
                {!loadingNotes && !notes.length ? <p className="mt-3 text-[12px] text-muted">No dentist notes saved for this patient yet.</p> : null}
                <div className="mt-3 space-y-3">
                  {!loadingNotes && notes.map((note) => (
                    <article key={note.id} className="rounded-lg border border-border bg-page p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[10px] text-muted">
                          {note.updatedAt && note.updatedAt !== note.createdAt ? `Edited ${new Date(note.updatedAt).toLocaleString("en-PH")}` : `Saved ${note.createdAt ? new Date(note.createdAt).toLocaleString("en-PH") : ""}`}
                        </span>
                        <div className="flex gap-3">
                          <button type="button" onClick={() => { setEditingNoteId(note.id); setDraft(note.body); setSaved(false); }} className="text-[11px] font-semibold text-primary underline">Edit</button>
                          <button type="button" onClick={() => void removeNote(note.id)} disabled={deletingNoteId !== null} className="text-[11px] font-semibold text-danger underline disabled:opacity-50">
                            {deletingNoteId === note.id ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-[13px] text-slate">{note.body}</p>
                    </article>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p className="mt-4 text-[13px] text-muted">Select a patient to view or save private clinical notes.</p>
          )}
          {saved ? <p role="status" className="mt-3 text-[12px] text-primary">Dentist notes saved.</p> : null}
          {error ? <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p> : null}
        </section>
      </div>
      {selectedPatient ? (
        <section className="mt-5 rounded-card border border-border bg-white p-5 shadow-card">
          <h2 className="font-heading text-[17px] font-semibold text-heading">Booking notes</h2>
          <p className="mt-1 text-[12px] text-muted">Notes submitted with this patient’s appointment bookings.</p>
          {loadingAppointments ? <p className="mt-4 text-[12px] text-muted">Loading booking notes…</p> : null}
          {!loadingAppointments && appointments.length === 0 ? (
            <p className="mt-4 text-[12px] text-muted">This patient has no appointments yet.</p>
          ) : null}
          {!loadingAppointments && appointments.length > 0 && !appointments.some((appointment) => appointment.notes) ? (
            <p className="mt-4 text-[12px] text-muted">No notes were added to this patient’s bookings.</p>
          ) : null}
          <div className="mt-3 space-y-3">
            {!loadingAppointments && appointments.filter((appointment) => appointment.notes).map((appointment) => (
              <article key={appointment.id} className="rounded-lg border border-border bg-page p-4">
                <p className="text-[12px] font-semibold text-heading">
                  {appointment.date} · {appointment.service.name}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-[13px] text-slate">{appointment.notes}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
