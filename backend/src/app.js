import http from "node:http";
import { loadConfig, COOKIE_NAME } from "./config.js";
import { openDb } from "./db.js";
import { HttpError, notFound } from "./lib/errors.js";
import { Router, Reply, RAW } from "./lib/router.js";
import { Hub } from "./lib/events.js";
import { parseCookies, verifyToken, RateLimiter } from "./lib/security.js";
import { seedIfEmpty } from "./seed.js";

import authRoutes from "./routes/auth.js";
import catalogRoutes from "./routes/services.js";
import dentistRoutes from "./routes/dentists.js";
import patientRoutes from "./routes/patients.js";
import appointmentRoutes from "./routes/appointments.js";
import messageRoutes from "./routes/messages.js";
import adminRoutes from "./routes/admin.js";


const MAX_BODY = 100 * 1024;

export function createApp(overrides = {}) {
  const config = loadConfig(overrides);
  const db = openDb(config.dbPath);
  const hub = new Hub();
  const router = new Router();
  const app = { config, db, hub, router, loginLimiter: new RateLimiter(10, 15 * 60_000) };

  router.get("/api/health", () => ({ status: "ok", time: config.clock().toISOString() }));
  for (const register of [authRoutes, catalogRoutes, dentistRoutes, patientRoutes, appointmentRoutes, messageRoutes, adminRoutes]) {
    register(router, app);
  }

  if (config.seedOnStart) seedIfEmpty(app);

  const server = http.createServer((req, res) => {
    handle(app, req, res).catch((err) => {
      console.error("Unhandled error", err);
      if (!res.headersSent) sendJson(res, 500, { error: { code: "internal_error", message: "Something went wrong" } });
    });
  });

  return {
    app, server,
    close() { hub.close(); server.closeAllConnections?.(); return new Promise((r) => server.close(() => { db.close(); r(); })); },
  };
}

function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload), ...headers });
  res.end(payload);
}

function applyCommonHeaders(app, req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  const origin = req.headers.origin;
  if (origin && app.config.corsOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Vary", "Origin");
  }
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "payload_too_large", "Request body too large");
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json", "Request body is not valid JSON");
  }
}

function authenticate(app, req, url) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : parseCookies(req.headers.cookie)[COOKIE_NAME];
  const payload = verifyToken(token, app.config.jwtSecret);
  if (!payload) return null;
  const u = app.db.prepare("SELECT id, role, email, full_name, active FROM users WHERE id = ?").get(payload.sub);
  if (!u || !u.active) return null;
  return { id: u.id, role: u.role, email: u.email, fullName: u.full_name };
}

async function handle(app, req, res) {
  const { config, router } = app;
  applyCommonHeaders(app, req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, "http://localhost");
  const { route, params, pathMatched } = router.match(req.method, url.pathname);

  try {
    if (!route) {
      if (pathMatched) throw new HttpError(405, "method_not_allowed", "Method not allowed");
      throw notFound("Endpoint");
    }

    const mutating = !["GET", "HEAD"].includes(req.method);
    if (mutating && req.headers.origin && !config.corsOrigins.includes(req.headers.origin)) {
      throw new HttpError(403, "bad_origin", "Cross-origin request blocked");
    }

    const body = mutating ? await readJson(req) : undefined;
    const ctx = {
      app, db: app.db, config, hub: app.hub, req, res, url, params, body,
      query: Object.fromEntries(url.searchParams),
      user: authenticate(app, req, url),
      setCookie: [],
    };

    let result;
    for (const handler of route.handlers) result = await handler(ctx);
    if (result === RAW) return;

    const headers = {};
    if (ctx.setCookie.length) headers["Set-Cookie"] = ctx.setCookie;
    if (result === undefined) { res.writeHead(204, headers); return res.end(); }
    if (result instanceof Reply) {
      if (typeof result.body === "string") {
        res.writeHead(result.status, { "Content-Length": Buffer.byteLength(result.body), ...result.headers, ...headers });
        return res.end(result.body);
      }
      return sendJson(res, result.status, result.body, { ...result.headers, ...headers });
    }
    return sendJson(res, 200, result, headers);
  } catch (err) {
    if (err instanceof HttpError) {
      const extra = err.status === 413 ? { Connection: "close" } : {};
      return sendJson(res, err.status, { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } }, extra);
    }
    if (err?.code === "ERR_SQLITE_ERROR" && /UNIQUE/.test(err.message)) {
      return sendJson(res, 409, { error: { code: "duplicate", message: "A record with these details already exists" } });
    }
    console.error(`[${req.method} ${url.pathname}]`, err);
    return sendJson(res, 500, { error: { code: "internal_error", message: "Something went wrong" } });
  }
}
