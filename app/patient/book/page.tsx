import { EmptyState, PageHeader } from "@/components/ui/empty-state";

export default function BookPage() {
  return (
    <div className="px-6 py-8 lg:px-8">
      <PageHeader
        kicker="Clinical Appointments & Scheduling"
        title="Book an Appointment"
        description="Choose your treatment, preferred dentist, and convenient time slot."
      />
      <EmptyState
        title="Booking steps are next"
        description="The 4-step booking flow (service, dentist, date & time, review) will appear here. No online payment is required — settle over-the-counter after your visit."
      />
    </div>
  );
}
