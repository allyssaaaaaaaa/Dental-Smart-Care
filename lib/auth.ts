export const ROLES = ["patient", "clerk", "dentist", "admin"] as const;
export type Role = (typeof ROLES)[number];

export type Session = {
  role: Role;
  name: string;
  title: string;
  pid?: string;
};

export const SESSION_COOKIE = "sc-session";

export const DEMO_USERS: Record<Role, Session> = {
  patient: {
    role: "patient",
    name: "Maria Santos",
    title: "Patient",
    pid: "SC-98214",
  },
  clerk: {
    role: "clerk",
    name: "Ally Cy",
    title: "Clinic Assistant",
  },
  dentist: {
    role: "dentist",
    name: "Dr. Elena Santos, DMD",
    title: "Attending Dentist",
  },
  admin: {
    role: "admin",
    name: "Admin",
    title: "Clinic Practice Director",
  },
};

export const ROLE_HOME: Record<Role, string> = {
  patient: "/patient/book",
  clerk: "/clerk",
  dentist: "/dentist",
  admin: "/admin",
};

export function isRole(value: string | undefined | null): value is Role {
  return ROLES.includes(value as Role);
}

export function parseSession(raw: string | undefined | null): Session | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(decodeURIComponent(raw)) as Session;
    if (!isRole(data.role) || !data.name) return null;
    return data;
  } catch {
    return null;
  }
}

export function serializeSession(session: Session): string {
  return encodeURIComponent(JSON.stringify(session));
}

export function roleFromPath(pathname: string): Role | null {
  if (pathname === "/patient" || pathname.startsWith("/patient/")) return "patient";
  if (pathname === "/clerk" || pathname.startsWith("/clerk/")) return "clerk";
  if (pathname === "/dentist" || pathname.startsWith("/dentist/")) return "dentist";
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  return null;
}
