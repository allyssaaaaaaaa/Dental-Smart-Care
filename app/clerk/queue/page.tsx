import { EmptyState, PageHeader } from "@/components/ui/empty-state";

export default function ClerkQueuePage() {
  return (
    <div className="px-6 py-8 lg:px-8">
      <PageHeader
        title="Clinic Rooms Overview"
        description="Live room status and availability. Emergencies receive #E-xxx tokens and go first."
      />
      <EmptyState
        title="Queue board coming next"
        description="Call Next, Mark Finishing, Assign Next Patient, and Mark Room as Cleaned will be available on this page."
      />
    </div>
  );
}
