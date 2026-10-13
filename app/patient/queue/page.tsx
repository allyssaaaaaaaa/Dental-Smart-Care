import { EmptyState, PageHeader } from "@/components/ui/empty-state";

export default function QueuePage() {
  return (
    <div className="px-6 py-8 lg:px-8">
      <PageHeader
        title="Live Clinic Queue Status"
        description="Real-time queue tracking for your scheduled appointment today."
      />
      <EmptyState
        title="You are not in the live queue"
        description="After check-in, your token, position, and estimated wait will appear here and update every few seconds."
      />
    </div>
  );
}
