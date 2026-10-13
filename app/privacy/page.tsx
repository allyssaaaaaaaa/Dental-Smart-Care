import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <Link href="/" className="inline-block">
        <Logo subtitle="Dental Clinic" />
      </Link>
      <h1 className="mt-8 font-heading text-[32px] font-bold">Privacy Policy</h1>
      <p className="mt-4 text-[14px] leading-relaxed text-body">
        Your records are kept confidential and secure. SmartCare Dental Clinic stores clinical notes, appointment
        history, and contact details only to provide care. We do not sell patient information.
      </p>
    </div>
  );
}
