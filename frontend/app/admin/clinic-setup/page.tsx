"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, RotateCcw, Save, Stethoscope, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/ui/empty-state";
import {
  createClinicDentist,
  createClinicService,
  deleteClinicDentist,
  deleteClinicService,
  getDentists,
  getServices,
  subscribeToClinicCatalog,
  updateClinicDentist,
  updateClinicService,
  type Dentist,
  type Service,
} from "@/lib/appointments";

const inputClass =
  "mt-1 w-full rounded-btn border border-border bg-white px-3 py-2.5 text-[13px] text-heading outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";
const initialService = { name: "", category: "", description: "", pricePhp: "", durationMin: "60", prepGuidelines: "" };
const initialDentist = { fullName: "", specialty: "", bio: "" };

export default function ClinicSetupPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [dentists, setDentists] = useState<Dentist[]>([]);
  const [serviceForm, setServiceForm] = useState(initialService);
  const [dentistForm, setDentistForm] = useState(initialDentist);
  const [editingServiceId, setEditingServiceId] = useState<number | null>(null);
  const [editingDentistId, setEditingDentistId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refreshCatalog = useCallback(async () => {
    const [serviceResult, dentistResult] = await Promise.all([
      getServices(true),
      getDentists(true),
    ]);
    setServices(serviceResult.items);
    setDentists(dentistResult.items);
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [serviceResult, dentistResult] = await Promise.all([
          getServices(true),
          getDentists(true),
        ]);
        if (!mounted) return;
        setServices(serviceResult.items);
        setDentists(dentistResult.items);
        setError("");
      } catch (cause) {
        if (mounted) setError(cause instanceof Error ? cause.message : "Could not load clinic settings.");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    const unsubscribe = subscribeToClinicCatalog(() => {
      void refreshCatalog().catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not refresh clinic settings.");
      });
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [refreshCatalog]);

  function clearServiceForm() {
    setServiceForm(initialService);
    setEditingServiceId(null);
  }

  function clearDentistForm() {
    setDentistForm(initialDentist);
    setEditingDentistId(null);
  }

  async function saveService(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const data = {
        name: serviceForm.name,
        category: serviceForm.category,
        description: serviceForm.description,
        pricePhp: Number(serviceForm.pricePhp),
        durationMin: Number(serviceForm.durationMin),
        prepGuidelines: serviceForm.prepGuidelines,
      };
      if (editingServiceId) await updateClinicService(editingServiceId, data);
      else await createClinicService(data);
      await refreshCatalog();
      clearServiceForm();
      setNotice(editingServiceId ? "Service updated." : "Service added.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this service.");
    } finally {
      setSaving(false);
    }
  }

  async function saveDentist(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (editingDentistId) await updateClinicDentist(editingDentistId, dentistForm);
      else await createClinicDentist(dentistForm);
      await refreshCatalog();
      clearDentistForm();
      setNotice(editingDentistId ? "Dentist updated." : "Dentist added.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this dentist.");
    } finally {
      setSaving(false);
    }
  }

  async function archiveService(service: Service) {
    setError("");
    setNotice("");
    try {
      await deleteClinicService(service.id);
      await refreshCatalog();
      setNotice(`${service.name} removed from booking.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove this service.");
    }
  }

  async function archiveDentist(dentist: Dentist) {
    setError("");
    setNotice("");
    try {
      await deleteClinicDentist(dentist.id);
      await refreshCatalog();
      setNotice(`${dentist.name} removed from booking.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove this dentist.");
    }
  }

  async function restoreService(service: Service) {
    setError("");
    try {
      await updateClinicService(service.id, { active: true });
      await refreshCatalog();
      setNotice(`${service.name} is available for booking again.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not restore this service.");
    }
  }

  async function restoreDentist(dentist: Dentist) {
    setError("");
    try {
      await updateClinicDentist(dentist.id, { active: true });
      await refreshCatalog();
      setNotice(`${dentist.name} is available for booking again.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not restore this dentist.");
    }
  }

  return (
    <div className="mx-auto max-w-[1200px] px-5 py-8 sm:px-8">
      <PageHeader
        kicker="Admin tools"
        title="Clinic Setup"
        description="Manage the services and dentist directory patients see when booking. Changes are shared with open booking pages."
      />

      {error ? <p role="alert" className="mb-4 rounded-btn border border-danger/30 bg-danger-bg px-4 py-3 text-[13px] text-danger">{error}</p> : null}
      {notice ? <p role="status" className="mb-4 rounded-btn border border-success/30 bg-success-bg px-4 py-3 text-[13px] text-success">{notice}</p> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-panel border border-divider bg-white p-5 shadow-card sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-heading text-[19px] font-bold text-heading">Services</h2>
              <p className="mt-1 text-[12px] text-muted">Update procedure names, prices, and booking details.</p>
            </div>
            <span className="rounded-pill bg-tint-2 px-2.5 py-1 text-[11px] font-semibold text-primary">{services.filter((item) => item.active !== false).length} active</span>
          </div>

          <form onSubmit={saveService} className="space-y-3 rounded-card border border-divider bg-page/40 p-4">
            <h3 className="text-[13px] font-semibold text-heading">{editingServiceId ? "Edit service" : "Add a service"}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-[12px] font-medium text-heading">Service name
                <input className={inputClass} required minLength={2} maxLength={100} value={serviceForm.name} onChange={(event) => setServiceForm({ ...serviceForm, name: event.target.value })} />
              </label>
              <label className="text-[12px] font-medium text-heading">Category
                <input className={inputClass} required minLength={2} maxLength={60} value={serviceForm.category} onChange={(event) => setServiceForm({ ...serviceForm, category: event.target.value })} />
              </label>
              <label className="text-[12px] font-medium text-heading">Price (PHP)
                <input className={inputClass} type="number" min="0" max="1000000" step="1" required value={serviceForm.pricePhp} onChange={(event) => setServiceForm({ ...serviceForm, pricePhp: event.target.value })} />
              </label>
              <label className="text-[12px] font-medium text-heading">Duration (minutes)
                <input className={inputClass} type="number" min="5" max="480" step="1" required value={serviceForm.durationMin} onChange={(event) => setServiceForm({ ...serviceForm, durationMin: event.target.value })} />
              </label>
            </div>
            <label className="block text-[12px] font-medium text-heading">Description
              <textarea className={inputClass} rows={2} maxLength={1000} value={serviceForm.description} onChange={(event) => setServiceForm({ ...serviceForm, description: event.target.value })} />
            </label>
            <label className="block text-[12px] font-medium text-heading">Preparation guidelines
              <textarea className={inputClass} rows={2} maxLength={2000} value={serviceForm.prepGuidelines} onChange={(event) => setServiceForm({ ...serviceForm, prepGuidelines: event.target.value })} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button disabled={saving} className="inline-flex items-center gap-2 rounded-btn bg-primary px-4 py-2.5 text-[12px] font-semibold text-white disabled:opacity-60">
                <Save size={15} /> {saving ? "Saving..." : editingServiceId ? "Save service" : "Add service"}
              </button>
              {editingServiceId ? <button type="button" onClick={clearServiceForm} className="inline-flex items-center gap-2 rounded-btn border border-border px-4 py-2.5 text-[12px] font-semibold text-heading"><X size={15} /> Cancel</button> : null}
            </div>
          </form>

          <div className="mt-5 divide-y divide-divider">
            {loading ? <p className="py-5 text-[13px] text-muted">Loading services...</p> : services.length ? services.map((service) => (
              <article key={service.id} className={`flex items-start justify-between gap-3 py-4 ${service.active === false ? "opacity-60" : ""}`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[13px] font-semibold text-heading">{service.name}</h3>
                    <span className="rounded-pill bg-tint-1 px-2 py-0.5 text-[10px] font-medium text-muted">{service.category}</span>
                    {service.active === false ? <span className="text-[10px] font-semibold text-danger">Inactive</span> : null}
                  </div>
                  <p className="mt-1 text-[12px] text-muted">₱{service.pricePhp.toLocaleString("en-PH")} · {service.durationMin} min</p>
                  {service.description ? <p className="mt-1 text-[12px] text-muted">{service.description}</p> : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  {service.active === false ? <button type="button" onClick={() => void restoreService(service)} className="rounded-btn p-2 text-primary hover:bg-tint-2" aria-label={`Restore ${service.name}`} title="Restore"><RotateCcw size={16} /></button> : <>
                    <button type="button" onClick={() => { setServiceForm({ name: service.name, category: service.category, description: service.description, pricePhp: String(service.pricePhp), durationMin: String(service.durationMin), prepGuidelines: service.prepGuidelines }); setEditingServiceId(service.id); }} className="rounded-btn p-2 text-slate hover:bg-page" aria-label={`Edit ${service.name}`} title="Edit"><Pencil size={16} /></button>
                    <button type="button" onClick={() => void archiveService(service)} className="rounded-btn p-2 text-danger hover:bg-danger-bg" aria-label={`Remove ${service.name}`} title="Remove"><Trash2 size={16} /></button>
                  </>}
                </div>
              </article>
            )) : <p className="py-5 text-[13px] text-muted">No services are set up yet.</p>}
          </div>
        </section>

        <section className="rounded-panel border border-divider bg-white p-5 shadow-card sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-heading text-[19px] font-bold text-heading">Dentist directory</h2>
              <p className="mt-1 text-[12px] text-muted">These dentists appear as booking choices. They are managed by the admin account.</p>
            </div>
            <span className="rounded-pill bg-tint-2 px-2.5 py-1 text-[11px] font-semibold text-primary">{dentists.filter((item) => item.active !== false).length} active</span>
          </div>

          <form onSubmit={saveDentist} className="space-y-3 rounded-card border border-divider bg-page/40 p-4">
            <h3 className="text-[13px] font-semibold text-heading">{editingDentistId ? "Edit dentist" : "Add a dentist"}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-[12px] font-medium text-heading">Dentist name
                <input className={inputClass} required minLength={2} maxLength={120} value={dentistForm.fullName} onChange={(event) => setDentistForm({ ...dentistForm, fullName: event.target.value })} />
              </label>
              <label className="text-[12px] font-medium text-heading">Specialty
                <input className={inputClass} maxLength={100} value={dentistForm.specialty} onChange={(event) => setDentistForm({ ...dentistForm, specialty: event.target.value })} placeholder="General Dentistry" />
              </label>
            </div>
            <label className="block text-[12px] font-medium text-heading">About the dentist
              <textarea className={inputClass} rows={3} maxLength={1000} value={dentistForm.bio} onChange={(event) => setDentistForm({ ...dentistForm, bio: event.target.value })} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button disabled={saving} className="inline-flex items-center gap-2 rounded-btn bg-primary px-4 py-2.5 text-[12px] font-semibold text-white disabled:opacity-60">
                <Plus size={15} /> {saving ? "Saving..." : editingDentistId ? "Save dentist" : "Add dentist"}
              </button>
              {editingDentistId ? <button type="button" onClick={clearDentistForm} className="inline-flex items-center gap-2 rounded-btn border border-border px-4 py-2.5 text-[12px] font-semibold text-heading"><X size={15} /> Cancel</button> : null}
            </div>
          </form>

          <div className="mt-5 divide-y divide-divider">
            {loading ? <p className="py-5 text-[13px] text-muted">Loading dentists...</p> : dentists.length ? dentists.map((dentist) => (
              <article key={dentist.id} className={`flex items-start justify-between gap-3 py-4 ${dentist.active === false ? "opacity-60" : ""}`}>
                <div className="flex min-w-0 gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tint-2 text-primary"><Stethoscope size={17} /></span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[13px] font-semibold text-heading">{dentist.name}</h3>
                      {dentist.active === false ? <span className="text-[10px] font-semibold text-danger">Inactive</span> : null}
                    </div>
                    <p className="mt-1 text-[12px] text-muted">{dentist.specialty || "General Dentistry"}</p>
                    {dentist.bio ? <p className="mt-1 text-[12px] text-muted">{dentist.bio}</p> : null}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  {dentist.active === false ? <button type="button" onClick={() => void restoreDentist(dentist)} className="rounded-btn p-2 text-primary hover:bg-tint-2" aria-label={`Restore ${dentist.name}`} title="Restore"><RotateCcw size={16} /></button> : <>
                    <button type="button" onClick={() => { setDentistForm({ fullName: dentist.name, specialty: dentist.specialty, bio: dentist.bio ?? "" }); setEditingDentistId(dentist.id); }} className="rounded-btn p-2 text-slate hover:bg-page" aria-label={`Edit ${dentist.name}`} title="Edit"><Pencil size={16} /></button>
                    <button type="button" onClick={() => void archiveDentist(dentist)} className="rounded-btn p-2 text-danger hover:bg-danger-bg" aria-label={`Remove ${dentist.name}`} title="Remove"><Trash2 size={16} /></button>
                  </>}
                </div>
              </article>
            )) : <p className="py-5 text-[13px] text-muted">No dentists are set up yet.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
