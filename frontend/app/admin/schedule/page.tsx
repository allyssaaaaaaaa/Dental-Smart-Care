import { EmptyState, PageHeader } from "@/components/ui/empty-state";

export default function AdminSchedulePage() {
  return (
    <div className="px-6 py-8 lg:px-8">
      <PageHeader title="Operatory Schedule" description="Chair occupancy across clinical wings." />
      <EmptyState
        title="Schedule map coming next"
        description="A simple operatory schedule will be added here for the clinic practice director."
      />
    </div>
  );
}
