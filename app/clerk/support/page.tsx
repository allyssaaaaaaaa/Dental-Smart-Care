import { PageHeader } from "@/components/ui/empty-state";

export default function ClerkSupportPage() {
  return (
    <div className="px-6 py-8 lg:px-8">
      <PageHeader title="Support Desk" description="Internal clinic help for front-desk staff." />
      <div className="max-w-lg rounded-card border border-divider bg-white p-6 shadow-card text-[14px] leading-relaxed text-body">
        For system issues, contact the clinic administrator. Patient profile create, search, and update remain
        clerk-only.
      </div>
    </div>
  );
}
