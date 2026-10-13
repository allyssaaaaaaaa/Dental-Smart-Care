import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { dentistNav } from "@/lib/nav";

function DentistHeaderStatus() {
  return (
    <div className="hidden items-center gap-2 md:flex">
      <span className="inline-flex items-center gap-1.5 rounded-pill bg-mint-bg px-3 py-1.5 text-[12px] font-semibold text-success">
        <span className="h-1.5 w-1.5 rounded-full bg-success-2" />
        Operatory 02 – In Procedure
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-pill bg-danger-bg px-3 py-1.5 text-[12px] font-semibold text-danger">
        Urgent Walk IN
      </span>
    </div>
  );
}

function DentistShell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      role="dentist"
      brandSubtitle="Clinical Chair"
      items={dentistNav}
      logoutLabel="Sign Out"
      headerRight={<DentistHeaderStatus />}
    >
      {children}
    </AppShell>
  );
}

export default function DentistLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-page" />}>
      <DentistShell>{children}</DentistShell>
    </Suspense>
  );
}
