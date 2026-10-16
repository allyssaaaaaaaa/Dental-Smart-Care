import { COOKIE_NAME } from "../config.js";
import { tx } from "../db.js";
import { HttpError, unauthorized } from "../lib/errors.js";
import { created, requireAuth } from "../lib/router.js";
import { hashPassword, signToken, verifyPassword } from "../lib/security.js";
import { parse } from "../lib/validate.js";
import { dentistOfUser, nextPatientCode, patientOfUser } from "../services/lookup.js";

const TITLES = { patient: "Patient", clerk: "Clinic Assistant", dentist: "Attending Dentist", admin: "Dentist & Clinic Administrator" };

export function userView(db, u) {
  const base = { id: u.id, role: u.role, fullName: u.full_name ?? u.fullName, email: u.email, title: TITLES[u.role] };
  if (u.role === "patient") {
    const p = patientOfUser(db, u.id);
    return { ...base, patientId: p?.id ?? null, patientCode: p?.code ?? null };
  }
  if (u.role === "dentist" || u.role === "admin") return { ...base, dentistId: dentistOfUser(db, u.id)?.id ?? null };
  return base;
}

function startSession(ctx, userRow) {
  const { config } = ctx;
  const token = signToken({ sub: userRow.id, role: userRow.role }, config.jwtSecret, config.tokenTtlSec);
  ctx.setCookie.push(
    `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${config.tokenTtlSec}${config.cookieSecure ? "; Secure" : ""}`,
  );
  return { token, user: userView(ctx.db, userRow) };
}

export default function register(router, app) {
  router.post("/api/auth/register", (ctx) => {
    const data = parse(ctx.body, {
      fullName: { type: "string", required: true, min: 2, max: 120 },
      email: { type: "email", required: true },
      password: { type: "password", required: true },
      phone: { type: "phone", required: true },
      birthDate: { type: "birthDate" },
      sex: { type: "enum", values: ["female", "male", "other"] },
    });
    const userRow = tx(ctx.db, () => {
      if (ctx.db.prepare("SELECT 1 FROM users WHERE email = ?").get(data.email)) {
        throw new HttpError(409, "email_taken", "An account with this email already exists", { email: "Already registered" });
      }
      const { lastInsertRowid: uid } = ctx.db
        .prepare("INSERT INTO users (role, email, password_hash, full_name, phone) VALUES ('patient', ?, ?, ?, ?)")
        .run(data.email, hashPassword(data.password), data.fullName, data.phone);
      const { lastInsertRowid: pid } = ctx.db
        .prepare("INSERT INTO patients (user_id, full_name, birth_date, sex, phone, email, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(uid, data.fullName, data.birthDate ?? null, data.sex ?? null, data.phone, data.email, uid);
      ctx.db.prepare("UPDATE patients SET code = ? WHERE id = ?").run(nextPatientCode(ctx.db, Number(pid)), pid);
      return ctx.db.prepare("SELECT * FROM users WHERE id = ?").get(uid);
    });
    return created(startSession(ctx, userRow));
  });

  router.post("/api/auth/login", (ctx) => {
    const { email, password } = parse(ctx.body, {
      email: { type: "email", required: true },
      password: { type: "string", required: true, max: 128 },
    });
    const key = `${ctx.req.socket.remoteAddress}|${email}`;
    if (!app.loginLimiter.take(key)) throw new HttpError(429, "too_many_attempts", "Too many sign-in attempts. Try again in 15 minutes.");
    const u = ctx.db.prepare("SELECT * FROM users WHERE email = ? AND active = 1").get(email);
    // Always run a hash comparison so response time doesn't reveal whether the email exists
    const ok = verifyPassword(password, u?.password_hash ?? "scrypt$00$00");
    if (!u || !ok || !["patient", "admin"].includes(u.role)) throw unauthorized("Incorrect email or password");
    app.loginLimiter.clear(key);
    return startSession(ctx, u);
  });

  // Role-picker login used by the demo UI. Disabled unless DEMO_MODE=true.
  router.post("/api/auth/demo-login", (ctx) => {
    if (!ctx.config.demoMode) throw new HttpError(404, "not_found", "Endpoint not found");
    const { role } = parse(ctx.body, { role: { type: "enum", values: ["patient", "clerk", "dentist", "admin"], required: true } });
    const u = ctx.db.prepare("SELECT * FROM users WHERE role = ? AND active = 1 ORDER BY id LIMIT 1").get(role);
    if (!u) throw new HttpError(404, "not_found", `No ${role} account exists. Run the seed script.`);
    return startSession(ctx, u);
  });

  router.post("/api/auth/logout", (ctx) => {
    ctx.setCookie.push(`${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
    return undefined;
  });

  router.get("/api/auth/me", requireAuth, (ctx) => ({ user: userView(ctx.db, ctx.user) }));

  router.post("/api/auth/change-password", requireAuth, (ctx) => {
    const data = parse(ctx.body, {
      currentPassword: { type: "string", required: true, max: 128 },
      newPassword: { type: "password", required: true },
    });
    const u = ctx.db.prepare("SELECT * FROM users WHERE id = ?").get(ctx.user.id);
    if (!verifyPassword(data.currentPassword, u.password_hash)) {
      throw new HttpError(422, "validation_error", "Current password is incorrect", { currentPassword: "Incorrect" });
    }
    ctx.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(data.newPassword), u.id);
    return undefined;
  });
}
