export const ROLES = ["patient", "admin"] as const;
export type AuthRole = (typeof ROLES)[number];
export type Role = AuthRole | "clerk";

export type Session = {
  id: number;
  role: AuthRole;
  name: string;
  title: string;
  email: string;
  pid?: string;
};

export const SESSION_COOKIE = "sc_token";

export const ROLE_HOME: Record<AuthRole, string> = {
  patient: "/patient/book",
  admin: "/admin",
};

export function isRole(value: string | undefined | null): value is AuthRole {
  return value === "patient" || value === "admin";
}

export function roleFromPath(pathname: string): Role | null {
  if (pathname === "/patient" || pathname.startsWith("/patient/")) return "patient";
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  if (pathname === "/dentist" || pathname.startsWith("/dentist/")) return "admin";
  if (pathname === "/clerk" || pathname.startsWith("/clerk/")) return "admin";
  return null;
}

export function sessionFromUser(user: {
  id: number;
  role: string;
  fullName: string;
  title: string;
  email: string;
  patientCode?: string | null;
}): Session | null {
  if (!isRole(user.role)) return null;
  return {
    id: user.id,
    role: user.role,
    name: user.fullName,
    title: user.role === "admin" ? "Dentist & Clinic Administrator" : user.title,
    email: user.email,
    ...(user.patientCode ? { pid: user.patientCode } : {}),
  };
}
