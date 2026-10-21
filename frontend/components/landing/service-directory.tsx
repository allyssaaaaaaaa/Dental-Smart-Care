"use client";

import { useEffect, useState } from "react";
import { Stethoscope } from "lucide-react";
import {
  getServices,
  subscribeToPublicClinicCatalog,
  type Service,
} from "@/lib/appointments";

function php(amount: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function ServiceDirectory() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const result = await getServices();
        if (!mounted) return;
        setServices(result.items);
        setError("");
      } catch (cause) {
        if (mounted) {
          setError(cause instanceof Error ? cause.message : "Could not load the service catalog.");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void refresh();
    const unsubscribe = subscribeToPublicClinicCatalog(() => {
      void refresh();
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {loading ? (
        <p className="text-[13px] text-muted" role="status">Loading services...</p>
      ) : error ? (
        <p className="text-[13px] text-danger" role="alert">{error}</p>
      ) : services.length ? (
        services.map((service) => (
          <article
            key={service.id}
            className="flex flex-col rounded-card border border-divider bg-[#FBFCFB] p-5 shadow-card"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-tint-2 text-primary">
                <Stethoscope className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="rounded-pill bg-mint-bg px-2.5 py-1 text-[11px] font-bold text-teal">
                {service.category}
              </span>
            </div>
            <h3 className="mt-4 font-heading text-[16px] font-semibold leading-snug text-heading">
              {service.name}
            </h3>
            <p className="mt-2 flex-1 text-[13px] leading-relaxed text-muted">
              {service.description || "Contact the clinic for details about this service."}
            </p>
            <p className="mt-6 font-heading text-[28px] font-bold tracking-tight text-primary">
              {php(service.pricePhp)}
            </p>
            <p className="mt-1 text-[12px] text-muted">
              Estimated treatment time: {service.durationMin} min
            </p>
          </article>
        ))
      ) : (
        <p className="text-[13px] text-muted">Our service catalog is being updated.</p>
      )}
    </div>
  );
}
