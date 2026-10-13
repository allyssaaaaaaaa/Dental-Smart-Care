import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { adminNav } from "@/lib/nav";

function ChairState() {
  return (
    <div className="mx-3 mb-5 rounded-card bg-tint-2 p-3.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
          Current Chair State
        </p>
        <span className="h-2 w-2 rounded-full bg-success-2" />
      </div>
      <p className="mt-1 font-heading text-[14px] font-semibold leading-snug text-heading">
        Operatory 2: In-Progress
      </p>
      <p className="text-[12px] text-slate">Root Canal Therapy (#19)</p>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
        <span>Elapsed: 38m / 60m</span>
        <span className="rounded-pill bg-white px-2 py-0.5 font-medium text-info-2">Dr. Jenkins</span>
      </div>
    </div>
  );
}

function SterilizationQueue() {
  return (
    <div className="mb-3 rounded-card bg-tint-1 px-3 py-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-teal">
        Sterilization Queue
      </p>
      <div className="mt-1 flex items-center justify-between text-[12px] text-slate">
        <span>Autoclave Bay 01</span>
        <span className="font-medium text-heading">Ready (4 trays)</span>
      </div>
    </div>
  );
}

function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      role="admin"
      brandSubtitle="Clinical Operating System"
      items={adminNav}
      logoutLabel="Sign Out"
      sidebarExtraTop={<ChairState />}
      sidebarExtraBottom={<SterilizationQueue />}
    >
      {children}
    </AppShell>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-page" />}>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}
