import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <Link href="/" className="inline-block">
        <Logo subtitle="Dental Clinic" />
      </Link>
      <h1 className="mt-8 font-heading text-[32px] font-bold">Terms of Care</h1>
      <p className="mt-4 text-[14px] leading-relaxed text-body">
        Appointments may be booked online, as walk-ins, or via Messenger entries recorded by staff. Payment is
        over-the-counter only. Your records are kept confidential and secure.
      </p>
    </div>
  );
}
