import { EmptyState, PageHeader } from "@/components/ui/empty-state";

export default function WorkspacePage() {
  return (
    <div className="px-6 py-8 lg:px-8">
      <PageHeader
        title="Chairside Clinical Workspace"
        description="Chair-side tools for the clinical operating system."
      />
      <EmptyState
        title="Workspace coming later"
        description="This destination matches the admin sidebar in the designs. Patient profile create and update stay clerk-only."
      />
    </div>
  );
}
