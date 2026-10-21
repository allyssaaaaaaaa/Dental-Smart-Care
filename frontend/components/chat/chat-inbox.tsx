"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PageHeader } from "@/components/ui/empty-state";
import { apiRequest, getAppointments, sendConversationImage } from "@/lib/appointments";

type ChatRole = "patient" | "admin";
type Conversation = {
  id: number;
  patient: { id: number; name: string };
  dentist: { id: number; name: string };
  lastMessage: string | null;
  lastMessageAt: string | null;
  unread: number;
};
type ChatMessage = {
  id: number;
  conversationId: number;
  senderUserId: number;
  body: string;
  createdAt: string;
  updatedAt?: string | null;
  image?: { id: number; url: string; fileName: string; contentType: string } | null;
};
type AppointmentContact = {
  id: number;
  name: string;
  secondary: string;
};

export function ChatInbox({ role }: { role: ChatRole }) {
  const { session } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [contacts, setContacts] = useState<AppointmentContact[]>([]);
  const [activeContactId, setActiveContactId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [messageImage, setMessageImage] = useState<File | null>(null);
  const [bulkMessage, setBulkMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendingBulk, setSendingBulk] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [messageRefreshKey, setMessageRefreshKey] = useState(0);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");

  function chooseImage(file: File | undefined, setImage: (value: File | null) => void) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setImage(null);
      setError("Choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setImage(null);
      setError("Images must be 5 MB or smaller.");
      return;
    }
    setError("");
    setImage(file);
  }

  const loadInbox = useCallback(async () => {
    try {
      const [conversationResult, firstPage] = await Promise.all([
        apiRequest<{ items: Conversation[] }>("/api/conversations"),
        getAppointments("page=1&pageSize=100&order=desc"),
      ]);
      const pageCount = Math.ceil(firstPage.total / firstPage.pageSize);
      const remainingPages = await Promise.all(
        Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
          getAppointments(`page=${index + 2}&pageSize=100&order=desc`),
        ),
      );
      const appointments = [...firstPage.items, ...remainingPages.flatMap((page) => page.items)];
      const contactsById = new Map<number, AppointmentContact>();
      for (const appointment of appointments) {
        if (role === "admin" && !appointment.patient.hasAccount) continue;
        const id = role === "patient" ? appointment.dentist.id : appointment.patient.id;
        if (contactsById.has(id)) continue;
        contactsById.set(id, {
          id,
          name: role === "patient" ? appointment.dentist.name : appointment.patient.fullName,
          secondary: role === "patient" ? appointment.dentist.specialty : appointment.patient.code,
        });
      }
      if (role === "patient") {
        for (const conversation of conversationResult.items) {
          if (!contactsById.has(conversation.dentist.id)) {
            contactsById.set(conversation.dentist.id, {
              id: conversation.dentist.id,
              name: conversation.dentist.name,
              secondary: "Clinic messages",
            });
          }
        }
      }
      const nextContacts = [...contactsById.values()];
      setConversations(conversationResult.items);
      setContacts(nextContacts);
      setActiveContactId((current) => current ?? nextContacts[0]?.id ?? null);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load your conversations.");
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadInbox(), 0);
    return () => window.clearTimeout(timer);
  }, [loadInbox, refreshKey]);

  useEffect(() => {
    const refreshOnFocus = () => {
      setRefreshKey((current) => current + 1);
    };
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, []);

  const activeContact = contacts.find((contact) => contact.id === activeContactId) ?? null;
  const activeConversation = useMemo(
    () => conversations.find((conversation) => role === "patient"
      ? conversation.dentist.id === activeContactId
      : conversation.patient.id === activeContactId),
    [activeContactId, conversations, role],
  );
  const activeConversationId = activeConversation?.id ?? null;

  useEffect(() => {
    if (!activeConversationId) return;
    let cancelled = false;
    async function loadMessages() {
      try {
        const result = await apiRequest<{ items: ChatMessage[] }>(
          `/api/conversations/${activeConversationId}/messages?limit=100`,
        );
        if (cancelled) return;
        setMessages(result.items);
        await apiRequest(`/api/conversations/${activeConversationId}/read`, { method: "POST" });
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Could not load messages.");
      }
    }
    void loadMessages();
    const timer = window.setInterval(() => void loadMessages(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeConversationId, messageRefreshKey]);

  async function selectContact(contact: AppointmentContact) {
    setActiveContactId(contact.id);
    setError("");
    setNotice("");
    setMessages([]);
    const existing = conversations.find((conversation) => role === "patient"
      ? conversation.dentist.id === contact.id
      : conversation.patient.id === contact.id);
    if (existing) {
      setMessages([]);
      return;
    }
    try {
      const conversation = await apiRequest<Conversation>("/api/conversations", {
        method: "POST",
        body: JSON.stringify(role === "patient" ? { dentistId: contact.id } : { patientId: contact.id }),
      });
      setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
      setMessages([]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not open this conversation.");
    }
  }

  async function handleEditMessage(messageId: number) {
    const body = editDraft.trim();
    if (!activeConversationId || !body) return;
    setError("");
    try {
      const updated = await apiRequest<ChatMessage>(`/api/conversations/${activeConversationId}/messages/${messageId}`, {
        method: "PATCH",
        body: JSON.stringify({ body }),
      });
      setMessages((current) => current.map((item) => item.id === messageId ? { ...item, body: updated.body, updatedAt: updated.updatedAt ?? new Date().toISOString() } : item));
      setEditingMessageId(null);
      setEditDraft("");
      setNotice("Message updated.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not update this message.");
    }
  }

  async function handleDeleteMessage(messageId: number) {
    if (!activeConversationId) return;
    const confirmed = window.confirm("Delete this message?");
    if (!confirmed) return;
    setError("");
    try {
      await apiRequest(`/api/conversations/${activeConversationId}/messages/${messageId}`, { method: "DELETE" });
      setMessages((current) => current.filter((item) => item.id !== messageId));
      if (editingMessageId === messageId) {
        setEditingMessageId(null);
        setEditDraft("");
      }
      setNotice("Message deleted.");
      setRefreshKey((current) => current + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not delete this message.");
    }
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = message.trim();
    if ((!body && !messageImage) || !activeConversationId) return;
    setSending(true);
    setError("");
    try {
      if (body) {
        await apiRequest(`/api/conversations/${activeConversationId}/messages`, {
          method: "POST",
          body: JSON.stringify({ body }),
        });
      }
      if (messageImage) await sendConversationImage(activeConversationId, messageImage);
      setMessage("");
      setMessageImage(null);
      setMessageRefreshKey((current) => current + 1);
      setRefreshKey((current) => current + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not send this message.");
    } finally {
      setSending(false);
    }
  }

  async function sendToAllBookedPatients(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = bulkMessage.trim();
    if (!body || role !== "admin" || !contacts.length) return;
    setSendingBulk(true);
    setError("");
    setNotice("");
    let sent = 0;
    let failed = 0;
    for (const contact of contacts) {
      try {
        const conversation = await apiRequest<Conversation>("/api/conversations", {
          method: "POST",
          body: JSON.stringify({ patientId: contact.id }),
        });
        if (body) {
          await apiRequest(`/api/conversations/${conversation.id}/messages`, {
            method: "POST",
            body: JSON.stringify({ body }),
          });
        }
        sent += 1;
      } catch {
        failed += 1;
      }
    }
    setSendingBulk(false);
    setBulkMessage("");
    setNotice(`Message sent in ${sent} private chat${sent === 1 ? "" : "s"}${failed ? `; ${failed} patient${failed === 1 ? "" : "s"} could not be reached` : ""}.`);
    setRefreshKey((current) => current + 1);
  }

  return (
    <div className="px-6 py-8 lg:px-8">
      <PageHeader
        title={role === "patient" ? "Messages" : "Patient Messages"}
        description={role === "patient"
          ? "Chat privately with dentists you have booked."
          : "Chat privately with booked patients or message every patient with a booking."}
      />
      {role === "admin" ? (
        <form onSubmit={sendToAllBookedPatients} className="mb-5 rounded-card border border-border bg-white p-4 shadow-card">
          <label className="block text-[13px] font-semibold text-heading" htmlFor="message-all">Message all booked patients privately</label>
          <p className="mt-1 text-[12px] text-muted">This sends an individual message in each patient’s private chat. Only patients with a booking and an online account can receive it. Images are shared with every listed recipient, so never broadcast one patient’s private clinical image.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              id="message-all"
              value={bulkMessage}
              onChange={(event) => setBulkMessage(event.target.value)}
              maxLength={2000}
              className="min-w-0 flex-1 rounded-btn border border-border px-3 py-2 text-[13px] text-heading outline-none focus:border-primary"
              placeholder="Write a clinic update or reminder"
            />
            <button type="submit" disabled={sendingBulk || !contacts.length || !bulkMessage.trim()} className="rounded-btn bg-primary px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-60">
              {sendingBulk ? "Sending…" : `Send to ${contacts.length} patient${contacts.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </form>
      ) : null}

      {notice ? <p role="status" className="mb-4 rounded-lg bg-success/10 px-4 py-3 text-[13px] text-success">{notice}</p> : null}
      {error ? <p role="alert" className="mb-4 rounded-lg bg-danger/10 px-4 py-3 text-[13px] text-danger">{error}</p> : null}
      <section className="grid min-h-[520px] overflow-hidden rounded-card border border-border bg-white shadow-card md:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="border-b border-divider md:border-b-0 md:border-r">
          <h2 className="border-b border-divider px-4 py-3 text-[13px] font-semibold text-heading">
            {role === "patient" ? "Dentists from your bookings" : "Patients from your bookings"}
          </h2>
          {loading ? <p className="p-4 text-[12px] text-muted">Loading…</p> : null}
          {!loading && !contacts.length ? <p className="p-4 text-[12px] text-muted">Contacts appear here after an appointment is booked.</p> : null}
          <nav className="max-h-[300px] overflow-y-auto md:max-h-[470px]" aria-label="Chat contacts">
            {contacts.map((contact) => {
              const conversation = conversations.find((item) => role === "patient"
                ? item.dentist.id === contact.id
                : item.patient.id === contact.id);
              return (
                <button
                  key={contact.id}
                  type="button"
                  onClick={() => void selectContact(contact)}
                  aria-current={activeContactId === contact.id}
                  className={`block w-full border-b border-divider px-4 py-3 text-left hover:bg-page ${
                    activeContactId === contact.id ? "bg-tint-2" : ""
                  }`}
                >
                  <span className="block text-[13px] font-semibold text-heading">{contact.name}</span>
                  <span className="mt-1 block truncate text-[11px] text-muted">{conversation?.lastMessage ?? contact.secondary}</span>
                </button>
              );
            })}
          </nav>
        </aside>
        <div className="flex min-h-[500px] min-w-0 flex-col">
          <div className="border-b border-divider px-4 py-3">
            <h2 className="text-[13px] font-semibold text-heading">{activeContact?.name ?? "Select a contact"}</h2>
            {activeContact ? <p className="text-[11px] text-muted">{activeContact.secondary}</p> : null}
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto bg-page/50 p-4">
            {activeContact && !activeConversationId ? <p className="text-[12px] text-muted">Opening private chat…</p> : null}
            {activeConversationId && !messages.length ? <p className="text-center text-[12px] text-muted">Start the conversation.</p> : null}
            {activeConversationId ? messages.map((item) => {
              const mine = item.senderUserId === session?.id;
              const isEdited = !!item.updatedAt && new Date(item.updatedAt).getTime() !== new Date(item.createdAt).getTime();
              return (
              <div key={item.id} className={`flex ${mine ? "justify-end" : ""}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[13px] ${
                  mine ? "bg-primary text-white" : "bg-white text-heading shadow-card"
                }`}>
                  {editingMessageId === item.id && mine && !item.image ? (
                    <div className="space-y-2">
                      <textarea
                        value={editDraft}
                        onChange={(event) => setEditDraft(event.target.value)}
                        maxLength={2000}
                        rows={3}
                        className="w-full rounded-lg border border-border bg-white px-2 py-2 text-[12px] text-heading outline-none focus:border-primary"
                        aria-label="Edit message"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button type="button" onClick={() => { setEditingMessageId(null); setEditDraft(""); }} className="text-[11px] underline text-muted">Cancel</button>
                        <button type="button" onClick={() => void handleEditMessage(item.id)} disabled={!editDraft.trim()} className="rounded-btn bg-secondary px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-60">Save</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {item.image ? (
                        <a href={item.image.url} target="_blank" rel="noreferrer" aria-label={`Open image ${item.image.fileName}`}>
                          <Image src={item.image.url} alt={`Image shared: ${item.image.fileName}`} width={480} height={360} unoptimized className="max-h-72 w-auto max-w-full rounded-lg object-contain" />
                        </a>
                      ) : null}
                      {item.image && item.body.startsWith("Image attached: ") ? <p className="mt-1 text-[11px]">{item.image.fileName}</p> : !item.image ? <p className="whitespace-pre-wrap">{item.body}</p> : null}
                      <div className={`mt-1 flex items-center justify-end gap-2 text-[9px] ${mine ? "text-white/70" : "text-muted"}`}>
                        <span>
                          {new Date(item.createdAt).toLocaleString("en-PH", { dateStyle: "short", timeStyle: "short" })}
                        </span>
                        {isEdited ? <span>Edited</span> : null}
                      </div>
                    </>
                  )}
                  {mine && !item.image ? (
                    <div className="mt-2 flex justify-end gap-2">
                      <button type="button" onClick={() => { setEditingMessageId(item.id); setEditDraft(item.body); }} className="text-[11px] underline">Edit</button>
                      <button type="button" onClick={() => void handleDeleteMessage(item.id)} className="text-[11px] underline text-danger">Delete</button>
                    </div>
                  ) : mine && item.image ? (
                    <div className="mt-2 flex justify-end">
                      <button type="button" onClick={() => void handleDeleteMessage(item.id)} className="text-[11px] underline text-danger">Delete</button>
                    </div>
                  ) : null}
                </div>
              </div>
              );
            }) : null}
          </div>
          <form onSubmit={sendMessage} className="border-t border-divider p-3">
            {messageImage ? <p className="mb-2 text-[11px] text-muted">Attached: {messageImage.name} · <button type="button" onClick={() => setMessageImage(null)} className="text-danger underline">Remove</button></p> : null}
            <div className="flex gap-2">
            <label className="inline-flex cursor-pointer items-center rounded-btn border border-border px-3 py-2 text-[12px] font-semibold text-heading hover:border-primary" aria-label="Attach image">
              Image
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={!activeConversationId || sending} onChange={(event) => { chooseImage(event.target.files?.[0], setMessageImage); event.currentTarget.value = ""; }} />
            </label>
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={2000}
              disabled={!activeConversationId || sending}
              className="min-w-0 flex-1 rounded-btn border border-border px-3 py-2 text-[13px] text-heading outline-none focus:border-primary disabled:bg-page"
              placeholder={activeConversationId ? "Write a message…" : "Choose a booked contact to start"}
              aria-label="Message"
            />
            <button type="submit" disabled={!activeConversationId || sending || (!message.trim() && !messageImage)} className="rounded-btn bg-primary px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-60">
              {sending ? "Sending…" : "Send"}
            </button>
            </div>
            <p className="mt-1.5 text-[10px] text-muted">Attach JPEG, PNG, or WebP images up to 5 MB.</p>
          </form>
        </div>
      </section>
    </div>
  );
}
