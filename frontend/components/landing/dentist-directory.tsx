"use client";

import { useEffect, useState } from "react";
import { Stethoscope } from "lucide-react";
import {
  getDentists,
  subscribeToPublicClinicCatalog,
  type Dentist,
} from "@/lib/appointments";

export function DentistDirectory() {
  const [dentists, setDentists] = useState<Dentist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const result = await getDentists();
        if (!mounted) return;
        setDentists(result.items);
        setError("");
      } catch (cause) {
        if (mounted) {
          setError(cause instanceof Error ? cause.message : "Could not load the dentist directory.");
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
    <div className="mt-8 grid gap-4 md:grid-cols-3">
      {loading ? (
        <p className="text-[13px] text-muted" role="status">Loading our dentists...</p>
      ) : error ? (
        <p className="text-[13px] text-danger" role="alert">{error}</p>
      ) : dentists.length ? (
        dentists.map((dentist) => (
          <article key={dentist.id} className="overflow-hidden rounded-card bg-white shadow-card">
            <div className="flex h-[168px] items-center justify-center bg-tint-2">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-primary shadow-card">
                <Stethoscope className="h-8 w-8" aria-hidden="true" />
              </span>
            </div>
            <div className="p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-primary">Dentist</p>
              <h3 className="mt-1 font-heading text-[16px] font-semibold text-heading">{dentist.name}</h3>
              <p className="mt-0.5 text-[13px] font-medium text-primary">{dentist.specialty}</p>
              {dentist.bio ? <p className="mt-2 text-[13px] leading-relaxed text-muted">{dentist.bio}</p> : null}
              <div className="mt-3 flex items-center gap-2" aria-label={dentist.reviewCount ? `${dentist.ratingAverage} out of 5 from ${dentist.reviewCount} reviews` : "No reviews yet"}>
                <span className="flex gap-0.5 text-amber-500" aria-hidden="true">
                  {Array.from({ length: 5 }, (_, index) => (
                    <span key={index} className={dentist.ratingAverage && dentist.ratingAverage >= index + 1 ? "text-[15px]" : "text-[15px] opacity-30"}>★</span>
                  ))}
                </span>
                <span className="text-[11px] text-muted">
                  {dentist.reviewCount
                    ? `${dentist.ratingAverage}/5 · ${dentist.reviewCount} ${dentist.reviewCount === 1 ? "review" : "reviews"}`
                    : "No reviews yet"}
                </span>
              </div>
              {dentist.reviews?.map((review) => (
                <blockquote key={`${review.createdAt}-${review.rating}`} className="mt-3 border-l-2 border-primary/40 pl-3 text-[12px] italic leading-relaxed text-muted">
                  “{review.comment}”
                  <span className="mt-1 block not-italic text-[10px] font-medium text-slate">Verified patient · {review.rating}/5</span>
                </blockquote>
              ))}
            </div>
          </article>
        ))
      ) : (
        <p className="text-[13px] text-muted">Our dentist directory is being updated.</p>
      )}
    </div>
  );
}
