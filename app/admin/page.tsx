import { EmptyState, PageHeader } from "@/components/ui/empty-state";

export default function AdminAnalyticsPage() {
  return (
    <div className="px-6 py-8 lg:px-8">
      <PageHeader
        kicker="Executive Ops Cockpit"
        title="Throughput & Chair Capacity Intelligence"
        description="Analytics for no-shows, appointments by service, and daily ledger export."
      />
      <EmptyState
        title="Analytics coming next"
        description="Charts will replace autoclave, bur inventory, and financial ledger panels with no-show analytics and appointments-by-service. Export Daily Ledger as CSV."
      />
    </div>
  );
}
