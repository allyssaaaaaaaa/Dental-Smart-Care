import { EmptyState, PageHeader } from "@/components/ui/empty-state";

export default function AdminTriagePage() {
  return (
    <div className="px-6 py-8 lg:px-8">
      <PageHeader title="Live Queue & Triage" description="Priority board and operatory telemetry." />
      <EmptyState
        title="Triage board coming next"
        description="Waiting patients, pain-level flags, and chair assignments will appear on this page."
      />
    </div>
  );
}
