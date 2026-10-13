"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Menu, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { useAuth } from "@/components/auth/auth-provider";
import { NAV_ICONS } from "@/components/layout/nav-icons";
import { cn } from "@/lib/cn";
import type { NavItem } from "@/lib/nav";
import type { Role } from "@/lib/auth";

type AppShellProps = {
  role: Role;
  brandSubtitle: string;
  brandStacked?: boolean;
  items: NavItem[];
  helpHref?: string;
  helpLabel?: string;
  logoutLabel?: string;
  logoutDanger?: boolean;
  children: React.ReactNode;
  headerRight?: React.ReactNode;
  sidebarExtraTop?: React.ReactNode;
  sidebarExtraBottom?: React.ReactNode;
  showPatientCard?: boolean;
  showBell?: boolean;
};

function isActive(pathname: string, href: string) {
  if (href === "/clerk" || href === "/dentist" || href === "/admin") {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({
  items,
  pathname,
  onNavigate,
  variant,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
  variant: Role;
}) {
  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const Icon = NAV_ICONS[item.icon];
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] font-medium transition-colors",
              variant === "admin"
                ? active
                  ? "bg-primary text-white shadow-card"
                  : "text-slate hover:bg-tint-2"
                : active
                  ? "bg-tint-2 text-primary"
                  : "text-slate hover:bg-page",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            <span className="flex-1">{item.label}</span>
            {item.badge ? (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-pill bg-[#7C3AED] px-1.5 text-[11px] font-bold text-white">
                {item.badge}
              </span>
            ) : null}
            {item.dot && !item.badge ? (
              <span className="h-2 w-2 rounded-full bg-info-2" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({
  role,
  brandSubtitle,
  brandStacked = true,
  items,
  helpHref,
  helpLabel = "Help & Support",
  logoutLabel = "Log Out",
  logoutDanger = false,
  children,
  headerRight,
  sidebarExtraTop,
  sidebarExtraBottom,
  showPatientCard = false,
  showBell = true,
}: AppShellProps) {
  const pathname = usePathname();
  const { session, logout } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="px-4 pb-6 pt-5">
        <Logo subtitle={brandSubtitle} stacked={brandStacked} />
      </div>
      {sidebarExtraTop}
      <div className="flex-1 overflow-y-auto px-3">
        {role === "admin" ? (
          <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
            Clinical Navigation
          </p>
        ) : null}
        <NavLinks items={items} pathname={pathname} onNavigate={() => setOpen(false)} variant={role} />
      </div>
      <div className="mt-auto px-3 pb-4 pt-3">
        {sidebarExtraBottom}
        {showPatientCard && session ? (
          <div className="mb-3 flex items-center gap-2.5 rounded-[10px] bg-tint-2 px-3 py-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-primary shadow-card">
              <NAV_ICONS.userPlus className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-[13px] font-semibold text-heading">{session.name}</span>
              <span className="block font-mono text-[11px] text-muted">
                PID: #{session.pid}
              </span>
            </span>
          </div>
        ) : null}
        <div className="border-t border-divider pt-3">
          {helpHref ? (
            <Link
              href={helpHref}
              className="flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13px] font-medium text-slate hover:bg-page"
            >
              <NAV_ICONS.help className="h-4 w-4" />
              {helpLabel}
            </Link>
          ) : null}
          <button
            type="button"
            onClick={logout}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-[13px] font-medium hover:bg-page",
              logoutDanger ? "text-danger" : "text-slate",
            )}
          >
            <NAV_ICONS.logout className="h-4 w-4" />
            {logoutLabel}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-page">
      <aside className="hidden w-[248px] shrink-0 border-r border-divider bg-white lg:block">
        {sidebar}
      </aside>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-heading/40"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <div className="relative z-10 h-full w-[min(100%,280px)] bg-white shadow-raised">
            <button
              type="button"
              className="absolute right-3 top-3 rounded-btn p-1.5 text-slate"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-divider bg-white px-4 lg:h-[56px] lg:px-6">
          <button
            type="button"
            className="rounded-btn p-1.5 text-heading lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden lg:block" />
          <div className="ml-auto flex items-center gap-3">
            {headerRight}
            {showBell ? (
              <button
                type="button"
                className="relative rounded-full p-1.5 text-slate hover:bg-page"
                aria-label="Notifications"
              >
                <Bell className="h-4 w-4" />
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-danger" />
              </button>
            ) : null}
            {role !== "patient" && session ? (
              <div className="text-right">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-heading">
                  {session.name}
                </p>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                  {session.title}
                </p>
              </div>
            ) : null}
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
