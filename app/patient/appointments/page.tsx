import { EmptyState, PageHeader } from "@/components/ui/empty-state";

export default function AppointmentsPage() {
  return (
    <div className="px-6 py-8 lg:px-8">
      <PageHeader
        title="My Appointments"
        description="View, reschedule, or cancel your scheduled visits, and browse past dental appointment records."
      />
      <EmptyState
        title="No appointments to show yet"
        description="When you book a visit, upcoming and past appointments will be listed here with search, year filters, and pagination."
      />
    </div>
  );
}
