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
    | "help"
    | "logout";
  badge?: string;
  dot?: boolean;
};

export const patientNav: NavItem[] = [
  { href: "/patient/book", label: "Book Appointment", icon: "calendar" },
  { href: "/patient/appointments", label: "My Appointments", icon: "clipboard" },
];

export const clerkNav: NavItem[] = [
  { href: "/clerk", label: "Clerk Dashboard", icon: "layout" },
  { href: "/clerk/intake", label: "Patient Intake", icon: "userPlus" },
];

export const dentistNav: NavItem[] = [
  { href: "/dentist", label: "Clinical Schedule", icon: "stethoscope" },
];

export const adminNav: NavItem[] = [
  { href: "/admin/schedule", label: "Operatory Schedule", icon: "calendarDays" },
  { href: "/admin/workspace", label: "Chairside Clinical Workspace", icon: "stethoscope" },
  { href: "/admin", label: "Admin Analytics & Capacity", icon: "barChart" },
];
