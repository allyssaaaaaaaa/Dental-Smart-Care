import Image from "next/image";
import Link from "next/link";
import {
  Armchair,
  CalendarPlus,
  CheckCircle2,
  Handshake,
  Home,
  Mail,
  MapPin,
  Phone,
  Sparkles,
  UserRound,
} from "lucide-react";
import { SiteHeader } from "@/components/landing/site-header";
import { Logo } from "@/components/brand/logo";
import { DentistDirectory } from "@/components/landing/dentist-directory";
import { ServiceDirectory } from "@/components/landing/service-directory";

const FEATURES = [
  {
    icon: Home,
    title: "Discover Your Best Smile",
    body: "Track your smile progress.",
  },
  {
    icon: Sparkles,
    title: "Safe and Super Clean Tools",
    body: "Every single tool goes through a massive cleaning process, and fresh, safe tools are opened just for you, every time.",
  },
  {
    icon: Armchair,
    title: "Cozy Rooms, Peaceful Care",
    body: "Relax in our comfortable chairs. Enjoy a quiet, clean, and calm space where we take care of you, gently.",
  },
];

const STEPS = [
  {
    n: "01",
    icon: Sparkles,
    title: "Select Service",
    body: "Browse our list of services, including routine cleanings, tooth-colored fillings, tooth removals, or brace consultations.",
  },
  {
    n: "02",
    icon: UserRound,
    title: "Choose Dentist",
    body: "Select your preferred dentist based on their background and expertise.",
  },
  {
    n: "03",
    icon: CalendarPlus,
    title: "Pick Date & Time Slot",
    body: "Pick the best day and time for your visit with real-time schedule availability.",
  },
  {
    n: "04",
    icon: CheckCircle2,
    title: "Arrive for Easy Care",
    body: "Enjoy your visit in a clean, disinfected treatment room with attentive support from our friendly team.",
  },
];

export function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />

      <section className="relative overflow-hidden bg-gradient-to-b from-[#F3FAF7] via-white to-white">
        <div className="mx-auto max-w-[1200px] px-5 pb-16 pt-16 sm:px-8 sm:pb-20 sm:pt-20">
          <h1 className="max-w-[820px] font-heading text-[32px] font-bold leading-[1.15] tracking-tight text-heading sm:text-[36px]">
            Book your dental visit with confidence
          </h1>
          <p className="mt-4 max-w-[560px] text-[15px] leading-relaxed text-muted">
            Reserve a convenient date and time, then arrive for your scheduled appointment.
          </p>
        </div>
      </section>

      <section className="bg-tint-2">
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-16">
          <h2 className="max-w-[720px] font-heading text-[28px] font-bold leading-tight text-heading sm:text-[32px]">
            World-Class Dental Care & Modern Comfort Technology
          </h2>
          <p className="mt-3 text-[15px] text-muted">
            Every suite is designed for your comfort and precise, clean care.
          </p>

          <div className="mt-8 grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-stretch">
            <div className="relative overflow-hidden rounded-panel shadow-raised">
              <Image
                src="/clinic-suite.jpg"
                alt="Modern SmartCare treatment suite with dental chair and natural light"
                width={960}
                height={720}
                className="h-full min-h-[320px] w-full object-cover"
                priority
              />
              <span className="absolute bottom-4 left-4 h-3.5 w-8 rounded-pill bg-white/90 shadow-card" />
            </div>
            <div className="flex flex-col gap-4">
              {FEATURES.map((feature) => (
                <article
                  key={feature.title}
                  className="flex gap-4 rounded-card bg-white p-5 shadow-card"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-[#CFF5EA] text-primary">
                    <feature.icon className="h-5 w-5" strokeWidth={1.8} />
                  </span>
                  <div>
                    <h3 className="font-heading text-[16px] font-semibold text-heading">
                      {feature.title}
                    </h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted">{feature.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="services" className="scroll-mt-24 bg-white">
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-16">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-[560px]">
              <h2 className="font-heading text-[32px] font-bold text-heading">Our Services</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-muted">
                Affordable, ethical pricing with zero hidden surcharges or surprise billing. Complete peace of mind for
                every family member.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 self-start rounded-pill bg-tint-2 px-4 py-2 text-[12px] font-semibold text-slate">
              <Handshake className="h-4 w-4 text-primary" />
              Honest Pricing Model • Direct Over-the-Counter
            </div>
          </div>

          <ServiceDirectory />

          <div className="mt-6 flex flex-col gap-3 rounded-card bg-tint-1 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <Link
              href="/login?next=/patient/book"
              className="shrink-0 text-[13px] font-semibold text-primary hover:text-primary-hover"
            >
              Select a Procedure →
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-[#F7F8FC] py-10 sm:py-14">
        <div className="mx-auto max-w-[1000px] px-5 sm:px-8">
          <div className="rounded-[20px] bg-gradient-to-br from-primary to-[#0A4A40] px-6 py-12 text-center text-white shadow-raised sm:px-16 sm:py-14">
            <h2 className="font-heading text-[28px] font-bold leading-tight sm:text-[34px]">
              Ready for a seamless dental visit?
            </h2>
            <p className="mx-auto mt-4 max-w-[640px] text-[15px] leading-relaxed text-white/80">
              Reserve your preferred dental specialist and operatory slot in under 2 minutes. No upfront deposit
              required.
            </p>
            <Link
              href="/login?audience=patient&next=/patient/book"
              className="mt-8 inline-flex items-center gap-2 rounded-pill bg-white px-6 py-3 text-[14px] font-semibold text-primary shadow-card hover:bg-mint-bg"
            >
              <CalendarPlus className="h-4 w-4" />
              Book an Appointment Now
            </Link>
            <p className="mx-auto mt-8 max-w-[560px] text-[12px] leading-relaxed text-white/55">
              Comprehensive oral health examinations, restorative treatments, and pediatric dentistry in our comfortable
              modern clinic.
            </p>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-24 bg-white">
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-16">
          <p className="text-center text-[11px] font-bold uppercase tracking-[0.18em] text-teal">
            Effortless Digital Journey
          </p>
          <h2 className="mt-2 text-center font-heading text-[28px] font-bold text-heading sm:text-[32px]">
            How SmartCare Operates in 4 Simple Steps
          </h2>
          <p className="mx-auto mt-2 max-w-[640px] text-center text-[14px] text-muted">
            Designed for maximum convenience. Experience easy healthcare scheduling built around your busy day.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {STEPS.map((step) => (
              <article key={step.n} className="relative rounded-card border border-divider bg-white p-5 shadow-card">
                <div className="flex items-start justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary font-heading text-[13px] font-bold text-white">
                    {step.n}
                  </span>
                  <step.icon className="h-5 w-5 text-border" strokeWidth={1.7} />
                </div>
                <h3 className="mt-5 font-heading text-[16px] font-semibold text-heading">{step.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-muted">{step.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="doctors" className="scroll-mt-24 bg-[#F7F8FC]">
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-16">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal">Licensed Dentists</p>
          <h2 className="mt-2 font-heading text-[32px] font-bold text-heading">Meet Your Attending Dentists</h2>
          <p className="mt-2 text-[14px] text-muted">
            Our team combines a gentle, friendly approach with modern digital tools for comfortable, long-lasting
            results.
          </p>

          <DentistDirectory />
        </div>
      </section>

      <footer className="border-t border-divider bg-[#F3F5FB]">
        <div className="mx-auto grid max-w-[1200px] gap-10 px-5 py-12 sm:px-8 lg:grid-cols-[1.2fr_1fr_1fr]">
          <div>
            <Logo subtitle="" markClassName="h-10 w-10 bg-[#E7F8F3] text-primary" />
            <p className="-mt-1 mb-3 font-heading text-[16px] font-semibold text-heading">SmartCare Dental</p>
            <p className="max-w-[360px] text-[13px] leading-relaxed text-muted">
              Providing ethical, advanced, and affordable oral healthcare. Championing UN SDG 3 (Good Health and
              Well-being) through transparent pricing and sterile clinical precision.
            </p>
          </div>
          <div>
            <h3 className="font-heading text-[16px] font-semibold text-heading">Operating Hours</h3>
            <dl className="mt-3 space-y-2 text-[13px]">
              <div className="flex justify-between gap-6">
                <dt className="text-muted">Monday - Friday</dt>
                <dd className="font-medium text-heading">8:00 AM - 5:00 PM</dd>
              </div>
              <div className="flex justify-between gap-6">
                <dt className="text-muted">Saturday</dt>
                <dd className="font-medium text-heading">8:00 AM - 5:00 PM</dd>
              </div>
              <div className="flex justify-between gap-6">
                <dt className="text-muted">Sunday</dt>
                <dd className="font-medium text-primary">Emergency Only</dd>
              </div>
            </dl>
            <p className="mt-3 text-[13px] text-muted">Pre-booked visits and scheduled consultations.</p>
          </div>
          <div>
            <h3 className="font-heading text-[16px] font-semibold text-heading">Contact & Location</h3>
            <ul className="mt-3 space-y-2.5 text-[13px] text-body">
              <li className="flex gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                402 Manila Arts Pavilion, Healthcare Blvd, Suite 201
              </li>
              <li className="flex gap-2">
                <Phone className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                +63 2 8248-CARE
              </li>
              <li className="flex gap-2">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                care@smartcaredental.org
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-divider">
          <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-5 py-5 text-[12px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <p>© 2025 SmartCare Dental Clinic. All clinical standards certified.</p>
            <div className="flex flex-wrap gap-5">
              <Link href="/privacy" className="hover:text-heading">
                Privacy Policy
              </Link>
              <Link href="/terms" className="hover:text-heading">
                Terms of Care
              </Link>
              <Link href="/disclaimer" className="hover:text-heading">
                Medical Disclaimer
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
