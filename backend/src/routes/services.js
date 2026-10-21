import { notFound } from "../lib/errors.js";
import { RAW, created, requireRole } from "../lib/router.js";
import { parse } from "../lib/validate.js";
import { serviceView } from "../services/lookup.js";

const serviceSchema = (required) => ({
  name: { type: "string", required, min: 2, max: 100 },
  category: { type: "string", required, min: 2, max: 60 },
  description: { type: "string", max: 1000 },
  pricePhp: { type: "int", required, min: 0, max: 1_000_000 },
  durationMin: { type: "int", required, min: 5, max: 480 },
  prepGuidelines: { type: "string", max: 2000 },
  active: { type: "bool" },
});

export default function register(router, app) {
  router.get("/api/catalog/stream", (ctx) => {
    ctx.res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...(ctx.res.getHeader("Access-Control-Allow-Origin") ? {
        "Access-Control-Allow-Origin": ctx.res.getHeader("Access-Control-Allow-Origin"),
        "Access-Control-Allow-Credentials": "true",
      } : {}),
    });
    ctx.res.write("retry: 3000\nevent: ready\ndata: {}\n\n");
    app.hub.addPublic(ctx.res);
    return RAW;
  });

  // Public service catalog: procedures, fees, durations, preparation guidelines
  router.get("/api/services", (ctx) => {
    const includeInactive = ctx.user?.role === "admin" && ctx.query.includeInactive === "1";
    const params = [];
    let sql = "SELECT * FROM services WHERE 1=1";
    if (!includeInactive) sql += " AND active = 1";
    if (ctx.query.category) { sql += " AND category = ?"; params.push(ctx.query.category); }
    if (ctx.query.q) { sql += " AND (name LIKE ? OR description LIKE ?)"; params.push(`%${ctx.query.q}%`, `%${ctx.query.q}%`); }
    const items = ctx.db.prepare(`${sql} ORDER BY category, name`).all(...params).map(serviceView);
    const categories = [...new Set(items.map((s) => s.category))];
    return { items, categories };
  });

  router.get("/api/services/:id", (ctx) => {
    const s = ctx.db.prepare("SELECT * FROM services WHERE id = ? AND active = 1").get(ctx.params.id);
    if (!s) throw notFound("Service");
    return serviceView(s);
  });

  router.post("/api/services", requireRole("admin"), (ctx) => {
    const d = parse(ctx.body, serviceSchema(true));
    const r = ctx.db
      .prepare("INSERT INTO services (name, category, description, price_php, duration_min, prep_guidelines) VALUES (?,?,?,?,?,?)")
      .run(d.name, d.category, d.description ?? "", d.pricePhp, d.durationMin, d.prepGuidelines ?? "");
    const item = serviceView(ctx.db.prepare("SELECT * FROM services WHERE id = ?").get(r.lastInsertRowid));
    ctx.hub.toCatalog("clinic.catalog.updated", { kind: "service", action: "created", id: item.id });
    return created(item);
  });

  router.patch("/api/services/:id", requireRole("admin"), (ctx) => {
    const cur = ctx.db.prepare("SELECT * FROM services WHERE id = ?").get(ctx.params.id);
    if (!cur) throw notFound("Service");
    const d = parse(ctx.body, serviceSchema(false));
    ctx.db.prepare(
      `UPDATE services SET name=?, category=?, description=?, price_php=?, duration_min=?, prep_guidelines=?, active=? WHERE id=?`,
    ).run(
      d.name ?? cur.name, d.category ?? cur.category, d.description ?? cur.description, d.pricePhp ?? cur.price_php,
      d.durationMin ?? cur.duration_min, d.prepGuidelines ?? cur.prep_guidelines, d.active === undefined ? cur.active : Number(d.active), cur.id,
    );
    const item = serviceView(ctx.db.prepare("SELECT * FROM services WHERE id = ?").get(cur.id));
    ctx.hub.toCatalog("clinic.catalog.updated", { kind: "service", action: d.active === false ? "deleted" : "updated", id: item.id });
    return item;
  });

  // Soft delete: keeps history of past appointments intact
  router.delete("/api/services/:id", requireRole("admin"), (ctx) => {
    const r = ctx.db.prepare("UPDATE services SET active = 0 WHERE id = ?").run(ctx.params.id);
    if (!r.changes) throw notFound("Service");
    ctx.hub.toCatalog("clinic.catalog.updated", { kind: "service", action: "deleted", id: Number(ctx.params.id) });
    return undefined;
  });
}
