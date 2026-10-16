import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function DisclaimerPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <Link href="/" className="inline-block">
        <Logo subtitle="Dental Clinic" />
      </Link>
      <h1 className="mt-8 font-heading text-[32px] font-bold">Medical Disclaimer</h1>
      <p className="mt-4 text-[14px] leading-relaxed text-body">
        Information on this site is for scheduling and clinic operations. It is not a diagnosis. Emergency dental
        pain should be assessed by the clinic. Your records are kept confidential and secure.
      </p>
    </div>
  );
}
