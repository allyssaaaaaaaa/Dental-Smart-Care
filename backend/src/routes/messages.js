import { tx } from "../db.js";
import { forbidden, invalid, notFound } from "../lib/errors.js";
import { RAW, created, requireAuth, requireRole } from "../lib/router.js";
import { iso } from "../lib/time.js";
import { parse, parseQuery } from "../lib/validate.js";
import { dentistOfUser, getPatientOrThrow, patientOfUser, requireDentistProfile, requirePatientProfile } from "../services/lookup.js";
import { getDentistOrThrow } from "../services/scheduling.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DENTIST_USER_ID = `CASE WHEN du.active = 1 THEN d.user_id
  ELSE (SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1) END`;
const CONV_SELECT = `
  SELECT c.*, p.full_name AS patient_name, p.user_id AS patient_user_id,
         du.full_name AS dentist_name, ${DENTIST_USER_ID} AS dentist_user_id,
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
const msgView = (m) => ({ id: m.id, conversationId: m.conversation_id, senderUserId: m.sender_user_id, body: m.body, readAt: iso(m.read_at), createdAt: iso(m.created_at), updatedAt: iso(m.updated_at) });
const imageMessageView = (m) => ({
  ...msgView(m),
  image: m.image_id ? {
    id: m.image_id,
    url: `/api/conversations/${m.conversation_id}/images/${m.image_id}`,
    fileName: m.image_file_name,
    contentType: m.image_content_type,
  } : null,
});

function detectImageType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function messageWithImage(ctx, messageId) {
  return ctx.db.prepare(
    `SELECT m.*, i.id AS image_id, i.file_name AS image_file_name, i.content_type AS image_content_type
     FROM messages m LEFT JOIN message_images i ON i.message_id = m.id WHERE m.id = ?`,
  ).get(messageId);
}

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
    const patient = ctx.user.role === "patient";
    const col = patient ? "c.patient_id" : `(${DENTIST_USER_ID})`;
    const me = patient ? requirePatientProfile(ctx.db, ctx.user) : requireDentistProfile(ctx.db, ctx.user);
    const rows = ctx.db.prepare(`${CONV_SELECT} WHERE ${col} = ? ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`).all(ctx.user.id, patient ? me.id : ctx.user.id);
    return { items: rows.map(convView), unreadTotal: rows.reduce((n, r) => n + r.unread, 0) };
  });

  // Patients choose a dentist; clinic admins can contact any booked patient.
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
      const hasVisit = ctx.user.role === "admin"
        ? ctx.db.prepare("SELECT 1 FROM appointments WHERE patient_id = ? LIMIT 1").get(patientId)
        : ctx.db.prepare("SELECT 1 FROM appointments WHERE dentist_id = ? AND patient_id = ? LIMIT 1").get(dentistId, patientId);
      if (!hasVisit) throw forbidden("You can only message patients who have booked with the clinic");
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
      rows = ctx.db.prepare(
        `SELECT m.*, i.id AS image_id, i.file_name AS image_file_name, i.content_type AS image_content_type
         FROM messages m LEFT JOIN message_images i ON i.message_id = m.id
         WHERE m.conversation_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT ?`,
      ).all(c.id, q.after, q.limit); // polling fallback
    } else {
      rows = ctx.db.prepare(
        `SELECT m.*, i.id AS image_id, i.file_name AS image_file_name, i.content_type AS image_content_type
         FROM messages m LEFT JOIN message_images i ON i.message_id = m.id
         WHERE m.conversation_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`,
      )
        .all(c.id, q.before ?? Number.MAX_SAFE_INTEGER, q.limit).reverse();
    }
    return { conversation: convView(c), items: rows.map(imageMessageView), hasMore: q.after === undefined && rows.length === q.limit };
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

  router.patch("/api/conversations/:id/messages/:messageId", requireRole("patient", "dentist", "admin"), (ctx) => {
    const c = loadConversation(ctx);
    const messageId = Number(ctx.params.messageId);
    if (!Number.isSafeInteger(messageId) || messageId < 1) throw notFound("Message");
    const current = ctx.db.prepare("SELECT * FROM messages WHERE id = ? AND conversation_id = ?").get(messageId, c.id);
    if (!current) throw notFound("Message");
    if (current.sender_user_id !== ctx.user.id) throw forbidden("You can only edit your own messages");
    if (ctx.db.prepare("SELECT 1 FROM message_images WHERE message_id = ? AND conversation_id = ?").get(messageId, c.id)) {
      throw invalid("Image attachments cannot be edited as text", { body: "Delete the image message and send a new one instead." });
    }
    const { body } = parse(ctx.body, { body: { type: "string", required: true, max: 2000 } });
    if (!body.trim()) throw invalid("Message body is required", { body: "Write a message before sending it." });
    const updated = tx(ctx.db, () => {
      ctx.db.prepare("UPDATE messages SET body = ?, updated_at = datetime('now') WHERE id = ? AND conversation_id = ?").run(body, messageId, c.id);
      return messageWithImage(ctx, messageId);
    });
    const view = imageMessageView(updated);
    for (const uid of [c.patient_user_id, c.dentist_user_id]) ctx.hub.toUser(uid, "message.updated", { conversationId: c.id, message: view });
    return view;
  });

  router.delete("/api/conversations/:id/messages/:messageId", requireRole("patient", "dentist", "admin"), (ctx) => {
    const c = loadConversation(ctx);
    const messageId = Number(ctx.params.messageId);
    if (!Number.isSafeInteger(messageId) || messageId < 1) throw notFound("Message");
    const current = ctx.db.prepare("SELECT * FROM messages WHERE id = ? AND conversation_id = ?").get(messageId, c.id);
    if (!current) throw notFound("Message");
    if (current.sender_user_id !== ctx.user.id) throw forbidden("You can only delete your own messages");
    tx(ctx.db, () => {
      ctx.db.prepare("DELETE FROM message_images WHERE message_id = ? AND conversation_id = ?").run(messageId, c.id);
      ctx.db.prepare("DELETE FROM messages WHERE id = ? AND conversation_id = ?").run(messageId, c.id);
      ctx.db.prepare(
        "UPDATE conversations SET last_message_at = (SELECT MAX(created_at) FROM messages WHERE conversation_id = ?) WHERE id = ?",
      ).run(c.id, c.id);
    });
    for (const uid of [c.patient_user_id, c.dentist_user_id]) ctx.hub.toUser(uid, "message.deleted", { conversationId: c.id, messageId });
    return { deleted: true, messageId };
  });

  router.post("/api/conversations/:id/images", requireRole("patient", "dentist", "admin"), (ctx) => {
    const c = loadConversation(ctx);
    const data = parse(ctx.body, {
      fileName: { type: "string", required: true, max: 120 },
      contentType: { type: "enum", values: ["image/jpeg", "image/png", "image/webp"], required: true },
      imageBase64: { type: "string", required: true, max: 7_000_000 },
    });
    const sanitizedName = data.fileName.replace(/[^\w.-]+/g, "_").slice(0, 120) || "image";
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.imageBase64)) {
      throw invalid("Image data is invalid", { image: "Upload a valid JPEG, PNG, or WebP image." });
    }
    const image = Buffer.from(data.imageBase64, "base64");
    if (!image.length || image.length > MAX_IMAGE_BYTES || image.toString("base64") !== data.imageBase64) {
      throw invalid("Image size or encoding is invalid", { image: "Image files must be 5 MB or smaller." });
    }
    if (detectImageType(image) !== data.contentType) {
      throw invalid("Image content does not match its file type", { image: "Upload a valid JPEG, PNG, or WebP image." });
    }
    const msg = tx(ctx.db, () => {
      const message = ctx.db.prepare(
        "INSERT INTO messages (conversation_id, sender_user_id, body) VALUES (?,?,?)",
      ).run(c.id, ctx.user.id, `Image attached: ${sanitizedName}`);
      ctx.db.prepare(
        `INSERT INTO message_images (conversation_id, message_id, file_name, content_type, byte_size, image_data)
         VALUES (?,?,?,?,?,?)`,
      ).run(c.id, message.lastInsertRowid, sanitizedName, data.contentType, image.length, image);
      ctx.db.prepare("UPDATE conversations SET last_message_at = datetime('now') WHERE id = ?").run(c.id);
      return messageWithImage(ctx, message.lastInsertRowid);
    });
    const view = imageMessageView(msg);
    for (const uid of [c.patient_user_id, c.dentist_user_id]) ctx.hub.toUser(uid, "message.new", { conversationId: c.id, message: view });
    return created(view);
  });

  router.get("/api/conversations/:id/images/:imageId", requireRole("patient", "dentist", "admin"), (ctx) => {
    const c = loadConversation(ctx);
    const imageId = Number(ctx.params.imageId);
    if (!Number.isSafeInteger(imageId) || imageId < 1) throw notFound("Image");
    const image = ctx.db.prepare(
      "SELECT content_type, file_name, image_data FROM message_images WHERE id = ? AND conversation_id = ?",
    ).get(imageId, c.id);
    if (!image) throw notFound("Image");
    ctx.res.writeHead(200, {
      "Content-Type": image.content_type,
      "Content-Length": image.image_data.length,
      "Content-Disposition": `inline; filename="${image.file_name.replace(/["\\]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    ctx.res.end(image.image_data);
    return RAW;
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
