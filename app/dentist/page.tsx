import { EmptyState, PageHeader } from "@/components/ui/empty-state";

export default function DentistPage() {
  return (
    <div className="px-6 py-8 lg:px-8">
      <PageHeader
        title="Good morning, Dr. Santos"
        description="Chair 02 Active. Availability toggle and today’s clinical schedule will appear here."
      />
      <EmptyState
        title="Dentist dashboard coming next"
        description="Live patient queue, current encounter, and today’s schedule will be built on this layout."
      />
    </div>
  );
}
