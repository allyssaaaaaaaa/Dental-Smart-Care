"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Shield, Stethoscope, UserRound, UserRoundCog } from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@/components/brand/logo";
import { useAuth } from "@/components/auth/auth-provider";
import { cn } from "@/lib/cn";
import { DEMO_USERS, ROLES, isRole, type Role } from "@/lib/auth";

const ROLE_META: Record<
  Role,
  { label: string; description: string; icon: typeof UserRound }
> = {
  patient: {
    label: "Patient",
    description: "Book visits, view appointments, and track the live queue.",
    icon: UserRound,
  },
  clerk: {
    label: "Clerk",
    description: "Front desk, patient intake, and live queue management.",
    icon: UserRoundCog,
  },
  dentist: {
    label: "Dentist",
    description: "Clinical schedule, chair status, and today’s patients.",
    icon: Stethoscope,
  },
  admin: {
    label: "Admin",
    description: "Analytics, triage, operatory schedule, and directory.",
    icon: Shield,
  },
};

export function LoginForm() {
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const audience = searchParams.get("audience");
  const next = searchParams.get("next") ?? undefined;

  const suggested = useMemo<Role | null>(() => {
    if (audience === "patient") return "patient";
    if (audience === "staff") return "clerk";
    const nextRole = next?.split("/")[1];
    if (isRole(nextRole)) return nextRole;
    return null;
  }, [audience, next]);

  const [role, setRole] = useState<Role | null>(suggested);
  const [error, setError] = useState("");

  const visibleRoles = audience === "patient" ? (["patient"] as Role[]) : ROLES;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!role) {
      setError("Please select a role to continue.");
      return;
    }
    setError("");
    toast.success(`Signed in as ${DEMO_USERS[role].name}`);
    login(role, role === "patient" ? next : undefined);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-[480px] rounded-panel border border-divider bg-white p-8 shadow-raised">
        <Logo subtitle="Dental Clinic" />
        <h1 className="mt-6 font-heading text-[28px] font-bold text-heading">Demo login</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          Choose a role to explore SmartCare. No password is required in this demo.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-3">
          {visibleRoles.map((id) => {
            const meta = ROLE_META[id];
            const Icon = meta.icon;
            const selected = role === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setRole(id);
                  setError("");
                }}
                className={cn(
                  "flex w-full items-start gap-3 rounded-card border px-4 py-3.5 text-left transition-colors",
                  selected
                    ? "border-primary bg-mint-bg"
                    : "border-divider bg-white hover:bg-page",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]",
                    selected ? "bg-primary text-white" : "bg-tint-2 text-primary",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block font-heading text-[15px] font-semibold text-heading">
                    {meta.label}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
                    {meta.description}
                  </span>
                  <span className="mt-1 block font-mono text-[11px] text-slate">
                    {DEMO_USERS[id].name}
                    {DEMO_USERS[id].pid ? ` · #${DEMO_USERS[id].pid}` : ""}
                  </span>
                </span>
              </button>
            );
          })}

          {error ? <p className="text-[13px] font-medium text-danger">{error}</p> : null}

          <button
            type="submit"
            className="mt-2 w-full rounded-btn bg-primary px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-primary-hover"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}
