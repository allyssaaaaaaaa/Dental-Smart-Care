import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { patientNav } from "@/lib/nav";

function PatientShell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      role="patient"
      brandSubtitle="Dental Clinic Portal"
      items={patientNav}
      helpHref="/patient/help"
      showPatientCard
    >
      {children}
    </AppShell>
  );
}

export default function PatientLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-page" />}>
      <PatientShell>{children}</PatientShell>
    </Suspense>
  );
}
