import { EmptyState, PageHeader } from "@/components/ui/empty-state";

export default function ClerkDashboardPage() {
  return (
    <div className="px-6 py-8 lg:px-8">
      <PageHeader
        title="Reception Desk Operations"
        description="Today’s confirmed visits, waiting lobby, and operatory status."
      />
      <EmptyState
        title="Dashboard panels coming next"
        description="Live front-desk queue, walk-in intake, and room status will be connected here. Only clerks can create, search, and update patient profiles."
      />
    </div>
  );
}
