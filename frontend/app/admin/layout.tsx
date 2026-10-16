import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { adminNav } from "@/lib/nav";

function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      role="admin"
      brandSubtitle="Clinical Operating System"
      items={adminNav}
      logoutLabel="Sign Out"
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
