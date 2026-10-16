import { EmptyState, PageHeader } from "@/components/ui/empty-state";

export default function ClerkDashboardPage() {
  return (
    <div className="px-6 py-8 lg:px-8">
      <PageHeader
        title="Reception Desk Operations"
        description="Today’s confirmed visits and patient registration."
      />
      <EmptyState
        title="Dashboard panels coming next"
        description="Patient registration and appointment management will be available here."
      />
    </div>
  );
}
