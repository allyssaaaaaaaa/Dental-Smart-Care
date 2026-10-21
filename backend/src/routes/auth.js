import { COOKIE_NAME } from "../config.js";
import { tx } from "../db.js";
import { HttpError, unauthorized } from "../lib/errors.js";
import { created, requireAuth } from "../lib/router.js";
import { hashPassword, signToken, verifyPassword } from "../lib/security.js";
import { parse } from "../lib/validate.js";
import { dentistOfUser, nextPatientCode, patientOfUser } from "../services/lookup.js";
import {
  decryptFaceDescriptor,
  encryptFaceDescriptor,
  euclideanDistance,
  isFaceDescriptor,
} from "../lib/face-descriptors.js";

const FACE_MATCH_THRESHOLD = 0.6;

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

export function startSession(ctx, userRow) {
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

  router.post("/api/auth/face-enroll", requireAuth, (ctx) => {
    if (!["patient", "admin"].includes(ctx.user.role)) {
      throw unauthorized("This account cannot enroll for face login");
    }
    if (ctx.body?.consent !== true) {
      throw new HttpError(422, "consent_required", "Explicit consent is required to store a face descriptor");
    }
    if (!isFaceDescriptor(ctx.body?.descriptor)) {
      throw new HttpError(422, "invalid_descriptor", "A 128-number face descriptor is required");
    }
    if (!/^[\da-f]{64}$/i.test(ctx.config.faceDescriptorKey)) {
      throw new HttpError(503, "face_login_unavailable", "Face login is not configured");
    }

    const encryptedDescriptor = encryptFaceDescriptor(ctx.body.descriptor, ctx.config.faceDescriptorKey);
    ctx.db.prepare(
      `UPDATE users SET face_descriptor = ?, face_descriptor_consent_at = datetime('now')
       WHERE id = ? AND active = 1`,
    )
      .run(encryptedDescriptor, ctx.user.id);
    return { success: true };
  });

  router.delete("/api/auth/face-enroll", requireAuth, (ctx) => {
    ctx.db.prepare(
      "UPDATE users SET face_descriptor = NULL, face_descriptor_consent_at = NULL WHERE id = ?",
    ).run(ctx.user.id);
    return { success: true };
  });

  router.post("/api/auth/face-login", (ctx) => {
    const key = `face|${ctx.req.socket.remoteAddress}`;
    if (!app.loginLimiter.take(key)) {
      throw new HttpError(429, "too_many_attempts", "Too many face sign-in attempts. Try again later.");
    }
    if (!isFaceDescriptor(ctx.body?.descriptor)) {
      throw new HttpError(422, "invalid_descriptor", "A 128-number face descriptor is required");
    }
    if (!/^[\da-f]{64}$/i.test(ctx.config.faceDescriptorKey)) {
      throw new HttpError(503, "face_login_unavailable", "Face login is not configured");
    }

    const candidates = ctx.db.prepare(
      `SELECT id, role, email, full_name, face_descriptor
       FROM users
       WHERE active = 1 AND role IN ('admin','patient') AND face_descriptor IS NOT NULL`,
    ).all();
    let match = null;
    let closestDistance = FACE_MATCH_THRESHOLD;

    for (const candidate of candidates) {
      const storedDescriptor = decryptFaceDescriptor(
        candidate.face_descriptor,
        ctx.config.faceDescriptorKey,
      );
      if (!storedDescriptor) {
        console.error(`Ignoring unreadable face descriptor for user ${candidate.id}`);
        continue;
      }
      const distance = euclideanDistance(ctx.body.descriptor, storedDescriptor);
      if (distance < closestDistance) {
        match = candidate;
        closestDistance = distance;
      }
    }

    if (!match) throw unauthorized("Unrecognized Face");
    const session = startSession(ctx, match);
    const redirectUrl = match.role === "admin" ? "/admin" : "/patient/book";
    return {
      success: true,
      token: session.token,
      role: match.role,
      redirectUrl,
      user: session.user,
    };
  });

  // Role-picker login used by the demo UI. Disabled unless DEMO_MODE=true.
  router.post("/api/auth/demo-login", (ctx) => {
    if (!ctx.config.demoMode) throw new HttpError(404, "not_found", "Endpoint not found");
    const { role } = parse(ctx.body, { role: { type: "enum", values: ["patient", "clerk", "admin"], required: true } });
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
