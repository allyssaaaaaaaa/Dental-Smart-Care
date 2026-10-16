import { tx } from "../db.js";
import { forbidden, invalid, notFound } from "../lib/errors.js";
import { RAW, created, requireAuth, requireRole } from "../lib/router.js";
import { iso } from "../lib/time.js";
import { parse, parseQuery } from "../lib/validate.js";
import { dentistOfUser, getPatientOrThrow, patientOfUser, requireDentistProfile, requirePatientProfile } from "../services/lookup.js";
import { getDentistOrThrow } from "../services/scheduling.js";

const CONV_SELECT = `
  SELECT c.*, p.full_name AS patient_name, p.user_id AS patient_user_id,
         du.full_name AS dentist_name, d.user_id AS dentist_user_id,
         (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body,
         (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.read_at IS NULL AND m.sender_user_id != ?) AS unread
  FROM conversations c
  JOIN patients p ON p.id = c.patient_id
  JOIN dentists d ON d.id = c.dentist_id
  JOIN users du   ON du.id = d.user_id`;

const convView = (c) => ({
  id: c.id,
  patient: { id: c.patient_id, name: c.patient_name },
  dentist: { id: c.dentist_id, name: c.dentist_name },
  lastMessage: c.last_body ?? null,
  lastMessageAt: iso(c.last_message_at),
  unread: c.unread,
});
const msgView = (m) => ({ id: m.id, conversationId: m.conversation_id, senderUserId: m.sender_user_id, body: m.body, readAt: iso(m.read_at), createdAt: iso(m.created_at) });

function loadConversation(ctx) {
  const c = ctx.db.prepare(`${CONV_SELECT} WHERE c.id = ?`).get(ctx.user.id, ctx.params.id);
  if (!c) throw notFound("Conversation");
  const ok = ctx.user.role === "patient" ? c.patient_user_id === ctx.user.id : c.dentist_user_id === ctx.user.id;
  if (!ok) throw notFound("Conversation"); // don't reveal other people's conversations
  return c;
}

// Direct patient <-> dentist chat. Clinic administrators act as the dentist in this clinic.
export default function register(router) {
  router.get("/api/conversations", requireRole("patient", "dentist", "admin"), (ctx) => {
    const col = ctx.user.role === "patient" ? "c.patient_id" : "c.dentist_id";
    const me = ctx.user.role === "patient" ? requirePatientProfile(ctx.db, ctx.user) : requireDentistProfile(ctx.db, ctx.user);
    const rows = ctx.db.prepare(`${CONV_SELECT} WHERE ${col} = ? ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`).all(ctx.user.id, me.id);
    return { items: rows.map(convView), unreadTotal: rows.reduce((n, r) => n + r.unread, 0) };
  });

  // Get-or-create. Patients choose a dentist; dentists can open a chat with their own patients.
  router.post("/api/conversations", requireRole("patient", "dentist", "admin"), (ctx) => {
    let patientId, dentistId;
    if (ctx.user.role === "patient") {
      ({ dentistId } = parse(ctx.body, { dentistId: { type: "int", required: true } }));
      patientId = requirePatientProfile(ctx.db, ctx.user).id;
      getDentistOrThrow(ctx.db, dentistId);
    } else {
      ({ patientId } = parse(ctx.body, { patientId: { type: "int", required: true } }));
      dentistId = requireDentistProfile(ctx.db, ctx.user).id;
      getPatientOrThrow(ctx.db, patientId);
      const hasVisit = ctx.db.prepare("SELECT 1 FROM appointments WHERE dentist_id = ? AND patient_id = ? LIMIT 1").get(dentistId, patientId);
      if (!hasVisit) throw forbidden("You can only message patients who have booked with you");
      if (!ctx.db.prepare("SELECT 1 FROM patients WHERE id = ? AND user_id IS NOT NULL").get(patientId)) {
        throw invalid("This patient has no online account to receive messages", { patientId: "No portal account" });
      }
    }
    let id = ctx.db.prepare("SELECT id FROM conversations WHERE patient_id = ? AND dentist_id = ?").get(patientId, dentistId)?.id;
    let isNew = false;
    if (!id) {
      id = Number(ctx.db.prepare("INSERT INTO conversations (patient_id, dentist_id) VALUES (?,?)").run(patientId, dentistId).lastInsertRowid);
      isNew = true;
    }
    const view = convView(ctx.db.prepare(`${CONV_SELECT} WHERE c.id = ?`).get(ctx.user.id, id));
    return isNew ? created(view) : view;
  });

  router.get("/api/conversations/:id/messages", requireRole("patient", "dentist", "admin"), (ctx) => {
    const c = loadConversation(ctx);
    const q = parseQuery(ctx.query, { after: { type: "int", min: 0 }, before: { type: "int", min: 1 }, limit: { type: "int", min: 1, max: 100, default: 50 } });
    let rows;
    if (q.after !== undefined) {
      rows = ctx.db.prepare("SELECT * FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id ASC LIMIT ?").all(c.id, q.after, q.limit); // polling fallback
    } else {
      rows = ctx.db.prepare("SELECT * FROM messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?")
        .all(c.id, q.before ?? Number.MAX_SAFE_INTEGER, q.limit).reverse();
    }
    return { conversation: convView(c), items: rows.map(msgView), hasMore: q.after === undefined && rows.length === q.limit };
  });

  router.post("/api/conversations/:id/messages", requireRole("patient", "dentist", "admin"), (ctx) => {
    const c = loadConversation(ctx);
    const { body } = parse(ctx.body, { body: { type: "string", required: true, max: 2000 } });
    const msg = tx(ctx.db, () => {
      const r = ctx.db.prepare("INSERT INTO messages (conversation_id, sender_user_id, body) VALUES (?,?,?)").run(c.id, ctx.user.id, body);
      ctx.db.prepare("UPDATE conversations SET last_message_at = datetime('now') WHERE id = ?").run(c.id);
      return msgView(ctx.db.prepare("SELECT * FROM messages WHERE id = ?").get(r.lastInsertRowid));
    });
    // real-time push to both participants (sender's other tabs included)
    for (const uid of [c.patient_user_id, c.dentist_user_id]) ctx.hub.toUser(uid, "message.new", { conversationId: c.id, message: msg });
    return created(msg);
  });

  router.post("/api/conversations/:id/read", requireRole("patient", "dentist", "admin"), (ctx) => {
    const c = loadConversation(ctx);
    const r = ctx.db.prepare("UPDATE messages SET read_at = datetime('now') WHERE conversation_id = ? AND sender_user_id != ? AND read_at IS NULL").run(c.id, ctx.user.id);
    const other = ctx.user.id === c.patient_user_id ? c.dentist_user_id : c.patient_user_id;
    if (r.changes) ctx.hub.toUser(other, "message.read", { conversationId: c.id });
    return { marked: Number(r.changes) };
  });

  // ---- Server-Sent Events: live chat, appointment & dentist-status updates ----
  // Browser: new EventSource("/api/stream", { withCredentials: true })
  router.get("/api/stream", requireAuth, (ctx) => {
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
    ctx.res.write(`retry: 3000\nevent: ready\ndata: ${JSON.stringify({ userId: ctx.user.id })}\n\n`);
    ctx.hub.add(ctx.res, ctx.user);
    return RAW;
  });
}
export { dentistOfUser, patientOfUser };
