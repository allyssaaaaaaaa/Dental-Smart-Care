import { PageHeader } from "@/components/ui/empty-state";

export default function HelpPage() {
  return (
    <div className="px-6 py-8 lg:px-8">
      <PageHeader title="Help & Support" description="Reach the SmartCare front desk." />
      <div className="max-w-lg rounded-card border border-divider bg-white p-6 shadow-card">
        <p className="text-[14px] leading-relaxed text-body">
          For appointment changes, call{" "}
          <span className="font-semibold text-heading">+63 2 8248-CARE</span> or email{" "}
          <span className="font-semibold text-heading">care@smartcaredental.org</span>.
        </p>
        <p className="mt-3 text-[13px] text-muted">
          Your records are kept confidential and secure. Payment is over-the-counter only.
        </p>
      </div>
    </div>
  );
}
