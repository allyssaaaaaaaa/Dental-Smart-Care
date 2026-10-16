import { EmptyState, PageHeader } from "@/components/ui/empty-state";

export default function IntakePage() {
  return (
    <div className="px-6 py-8 lg:px-8">
      <PageHeader
        title="Quick Walk-In Registration"
        description="Register new dental patients and verify existing profiles."
      />
      <EmptyState
        title="Intake form coming next"
        description="Clerk-only patient create and update, auto age from date of birth, +63 mobile numbers, and pay-at-counter totals will appear here."
      />
    </div>
  );
}
