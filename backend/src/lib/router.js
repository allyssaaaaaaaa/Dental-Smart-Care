import { HttpError, forbidden, unauthorized } from "./errors.js";

/** Returned by a handler to control status/headers/body explicitly. */
export class Reply {
  constructor(status, body, headers = {}) { this.status = status; this.body = body; this.headers = headers; }
}
export const created = (body) => new Reply(201, body);
export const RAW = Symbol("raw"); // handler already wrote to the response (SSE)

export class Router {
  constructor() { this.routes = []; }
  on(method, pattern, ...handlers) {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return "/([^/]+)"; })}/?$`);
    this.routes.push({ method, re, keys, handlers });
  }
  get(p, ...h) { this.on("GET", p, ...h); }
  post(p, ...h) { this.on("POST", p, ...h); }
  put(p, ...h) { this.on("PUT", p, ...h); }
  patch(p, ...h) { this.on("PATCH", p, ...h); }
  delete(p, ...h) { this.on("DELETE", p, ...h); }

  match(method, pathname) {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.re.exec(pathname);
      if (!m) continue;
      if (route.method !== method) { pathMatched = true; continue; }
      const params = {};
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route, params };
    }
    return { pathMatched };
  }
}

// ---- guards (use as non-final handlers) ----
export const requireAuth = (ctx) => { if (!ctx.user) throw unauthorized(); };
export const requireRole = (...roles) => (ctx) => {
  if (!ctx.user) throw unauthorized();
  if (!roles.includes(ctx.user.role)) throw forbidden(`This action requires one of: ${roles.join(", ")}`);
};
export { HttpError };
