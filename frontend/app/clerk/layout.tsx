import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { clerkNav } from "@/lib/nav";

function ClerkShell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      role="clerk"
      brandSubtitle="Dental"
      brandStacked={false}
      items={clerkNav}
      helpHref="/clerk/support"
      helpLabel="Support Desk"
      logoutLabel="Sign Out"
      logoutDanger
    >
      {children}
    </AppShell>
  );
}

export default function ClerkLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-page" />}>
      <ClerkShell>{children}</ClerkShell>
    </Suspense>
  );
}
