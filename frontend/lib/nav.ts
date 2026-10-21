export type NavItem = {
  href: string;
  label: string;
  icon:
    | "calendar"
    | "clipboard"
    | "layout"
    | "userPlus"
    | "calendarDays"
    | "stethoscope"
    | "chart"
    | "barChart"
    | "messages"
    | "settings"
    | "help"
    | "logout";
  badge?: string;
  dot?: boolean;
};

export const patientNav: NavItem[] = [
  { href: "/patient/book", label: "Book Appointment", icon: "calendar" },
  { href: "/patient/appointments", label: "My Appointments", icon: "clipboard" },
  { href: "/patient/messages", label: "Messages", icon: "messages" },
];

export const clerkNav: NavItem[] = [
  { href: "/clerk", label: "Clerk Dashboard", icon: "layout" },
  { href: "/clerk/intake", label: "Patient Intake", icon: "userPlus" },
];

export const adminNav: NavItem[] = [
  { href: "/admin/schedule", label: "Appointment Calendar", icon: "calendarDays" },
  { href: "/admin/walk-ins", label: "Walk-in Booking", icon: "userPlus" },
  { href: "/admin/messages", label: "Patient Messages", icon: "messages" },
  { href: "/admin/clinic-setup", label: "Clinic Setup", icon: "settings" },
  { href: "/admin/workspace", label: "Chairside Clinical Workspace", icon: "stethoscope" },
  { href: "/admin", label: "Admin Analytics & Capacity", icon: "barChart" },
];
