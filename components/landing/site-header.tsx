"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "#services", label: "Services" },
  { href: "#how-it-works", label: "How queuing works" },
  { href: "#doctors", label: "Doctors" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-divider bg-white">
      <div className="mx-auto flex h-[72px] max-w-[1200px] items-center justify-between px-5 sm:px-8">
        <Link href="/" className="shrink-0">
          <Logo subtitle="Dental Clinic" markClassName="h-10 w-10 rounded-[12px] bg-[#E7F8F3] text-primary" />
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-[14px] font-medium text-slate hover:text-heading"
            >
              {link.label}
            </a>
          ))}
          <Link
            href="/login?audience=staff&switch=1"
            className="rounded-pill border border-border bg-white px-4 py-2 text-[13px] font-semibold text-heading shadow-card hover:bg-page"
          >
            Staff Login
          </Link>
        </nav>

        <button
          type="button"
          className="rounded-btn p-2 text-heading md:hidden"
          aria-label="Open menu"
          onClick={() => setOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-heading/40"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <div className="relative ml-auto h-full w-[min(100%,300px)] bg-white p-5 shadow-raised">
            <div className="mb-6 flex items-center justify-between">
              <Logo subtitle="Dental Clinic" />
              <button type="button" aria-label="Close" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className={cn("rounded-btn px-3 py-2.5 text-[14px] font-medium text-heading hover:bg-page")}
                >
                  {link.label}
                </a>
              ))}
              <Link
                href="/login?audience=staff&switch=1"
                className="mt-3 rounded-pill border border-border px-4 py-2.5 text-center text-[13px] font-semibold"
              >
                Staff Login
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
