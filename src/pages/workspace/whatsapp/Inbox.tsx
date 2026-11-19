import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { supabase, type Tables } from "../../../lib/supabase";
import { useWorkspace } from "../../../lib/workspace";
import { useLiveTable } from "../../../lib/realtime";
import { nameOf, useMembers } from "../../../lib/members";
import { Alert, Badge, Button, Empty, Input, Spinner } from "../../../components/ui";
import { STAGE_LABEL, STAGE_TONE, type Stage } from "../leads/leadShared";

// WhatsApp Inbox: every chat with the company's WhatsApp number, the lead it
// belongs to, and a reply box. Staff see chats for their own leads; admins see all.

type Chat = Tables<"wa_chats">;
type Message = Tables<"wa_messages">;
type LeadInfo = Pick<Tables<"leads">, "id" | "name" | "phone" | "stage" | "source" | "assigned_to" | "follow_up_at" | "last_remark">;

type Filter = "unread" | "open" | "closed";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "unread", label: "Unread" },
  { key: "closed", label: "Closed" },
];
const WINDOW_MS = 24 * 3600 * 1000;

function time(d: string | null) {
  if (!d) return "";
  const t = new Date(d);
  const today = new Date().toDateString() === t.toDateString();
  return today
    ? t.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })
    : t.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function phoneLabel(waId: string) {
  return waId.length === 12 && waId.startsWith("91") ? `+91 ${waId.slice(2, 7)} ${waId.slice(7)}` : `+${waId}`;
}

async function errorText(error: unknown, fallback: string) {
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const b = await ctx.json();
      if (b?.message) return String(b.message);
    } catch {
      /* fall through */
    }
  }
  return fallback;
}

export default function Inbox() {
  const { workspace, canWrite, isAdmin } = useWorkspace();
  const people = useMembers(workspace.id);
  const [params, setParams] = useSearchParams();
  const selected = params.get("chat");
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [leads, setLeads] = useState<Record<string, LeadInfo>>({});
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [hasNumber, setHasNumber] = useState<boolean | null>(null);

  const loadChats = useCallback(async () => {
    const { data } = await supabase
      .from("wa_chats")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(300);
    const rows = data ?? [];
    setChats(rows);
    const ids = [...new Set(rows.map((c) => c.lead_id).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: l } = await supabase
        .from("leads")
        .select("id, name, phone, stage, source, assigned_to, follow_up_at, last_remark")
        .in("id", ids);
      setLeads(Object.fromEntries((l ?? []).map((x) => [x.id, x])));
    }
  }, [workspace.id]);

  useEffect(() => {
    loadChats();
  }, [loadChats]);
  useLiveTable("wa_chats", `workspace_id=eq.${workspace.id}`, loadChats);

  useEffect(() => {
    if (!isAdmin) return setHasNumber(true);
    supabase
      .from("whatsapp_numbers")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .eq("is_active", true)
      .then(({ count }) => setHasNumber((count ?? 0) > 0));
  }, [workspace.id, isAdmin]);

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase();
    return (chats ?? []).filter((c) => {
      if (filter === "unread" && c.unread_count === 0) return false;
      if (filter === "open" && c.status !== "open") return false;
      if (filter === "closed" && c.status !== "closed") return false;
      if (!words) return true;
      const lead = c.lead_id ? leads[c.lead_id] : null;
      return [c.contact_name, c.wa_id, lead?.name, c.last_message_preview].some((x) => x?.toLowerCase().includes(words));
    });
  }, [chats, leads, filter, q]);

  const unread = (chats ?? []).filter((c) => c.unread_count > 0).length;
  const chat = chats?.find((c) => c.id === selected) ?? null;
  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("chat", id);
    else next.delete("chat");
    setParams(next, { replace: true });
  };

  if (!chats) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">WhatsApp</h1>
          <p className="text-sm text-slate-500">Chats with your WhatsApp Business number. Replies go out from that number.</p>
        </div>
      </div>

      {hasNumber === false && (
        <Alert tone="info">No WhatsApp number is linked to this company yet. The Super Admin links it, then chats appear here.</Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)_280px]">
        {/* Chat list (hidden on phones while a chat is open) */}
        <section className={`rounded-xl bg-white shadow-sm ring-1 ring-slate-200/70 ${chat ? "hidden lg:block" : ""}`}>
          <div className="space-y-2 border-b border-slate-100 p-3">
            <Input placeholder="Search name, number or message" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="flex gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 transition ${
                    filter === f.key ? "bg-brand-50 text-brand-700 ring-brand-500/40" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {f.label}
                  {f.key === "unread" && unread > 0 ? ` ${unread}` : ""}
                </button>
              ))}
            </div>
          </div>
          <ul className="max-h-[65vh] divide-y divide-slate-100 overflow-y-auto">
            {shown.length === 0 && <li><Empty>No chats here.</Empty></li>}
            {shown.map((c) => {
              const lead = c.lead_id ? leads[c.lead_id] : null;
              const active = c.id === selected;
              return (
                <li key={c.id}>
                  <button
                    onClick={() => open(c.id)}
                    className={`block w-full px-3 py-2.5 text-left transition ${active ? "bg-brand-50" : "hover:bg-slate-50"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${c.unread_count ? "font-bold text-slate-900" : "font-semibold text-slate-800"}`}>
                        {lead?.name || c.contact_name || phoneLabel(c.wa_id)}
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-400">{time(c.last_message_at)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-slate-500">{c.last_message_preview}</span>
                      {c.unread_count > 0 && (
                        <span className="shrink-0 rounded-full bg-green-600 px-1.5 text-[11px] font-semibold text-white">{c.unread_count}</span>
                      )}
                    </div>
                    {isAdmin && lead && (
                      <div className="mt-0.5 truncate text-[11px] text-slate-400">{nameOf(people, lead.assigned_to) || "Not assigned"}</div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Conversation */}
        {chat ? (
          <Conversation key={chat.id} chat={chat} canWrite={canWrite} onBack={() => open(null)} people={people} />
        ) : (
          <section className="hidden items-center justify-center rounded-xl bg-white p-10 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200/70 lg:flex">
            Pick a chat on the left.
          </section>
        )}

        {/* Lead */}
        <section className={`rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 ${chat ? "" : "hidden lg:block"}`}>
          {chat ? <LeadSide slug={workspace.slug} chat={chat} lead={chat.lead_id ? leads[chat.lead_id] ?? null : null} people={people} /> : (
            <p className="text-sm text-slate-500">The lead for the chat shows here.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function Conversation({ chat, canWrite, onBack, people }: {
  chat: Chat; canWrite: boolean; onBack: () => void; people: ReturnType<typeof useMembers>;
}) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("wa_messages")
      .select("*")
      .eq("chat_id", chat.id)
      .order("created_at", { ascending: true })
      .limit(500);
    setMessages(data ?? []);
  }, [chat.id]);

  useEffect(() => {
    load();
  }, [load]);
  useLiveTable("wa_messages", `chat_id=eq.${chat.id}`, load, { delay: 200 });

  // Opening the chat (or a new message arriving while it is open) marks it read.
  useEffect(() => {
    if (chat.unread_count > 0) supabase.rpc("wa_mark_read", { p_chat_id: chat.id });
  }, [chat.id, chat.unread_count]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages?.length]);

  const windowOpen = !!chat.last_inbound_at && Date.now() - new Date(chat.last_inbound_at).getTime() < WINDOW_MS;
  const closesAt = chat.last_inbound_at ? new Date(new Date(chat.last_inbound_at).getTime() + WINDOW_MS) : null;

  async function send() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError("");
    const { data, error } = await supabase.functions.invoke("whatsapp-send", { body: { chat_id: chat.id, body } });
    setBusy(false);
    if (data?.ok) {
      setText("");
      load();
    } else {
      setError(data?.message ?? (await errorText(error, "The message didn't go. Try again.")));
      load();
    }
  }

  async function setStatus(status: "open" | "closed") {
    const { error } = await supabase.rpc("wa_set_chat_status", { p_chat_id: chat.id, p_status: status });
    if (error) setError(error.message);
  }

  return (
    <section className="flex min-h-[60vh] flex-col rounded-xl bg-white shadow-sm ring-1 ring-slate-200/70">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <button className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 lg:hidden" onClick={onBack}>← Chats</button>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{chat.contact_name || phoneLabel(chat.wa_id)}</div>
            <div className="text-xs text-slate-500">{phoneLabel(chat.wa_id)}</div>
          </div>
        </div>
        {canWrite && (
          <Button variant="secondary" onClick={() => setStatus(chat.status === "open" ? "closed" : "open")}>
            {chat.status === "open" ? "Close chat" : "Reopen"}
          </Button>
        )}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50/60 p-3" style={{ maxHeight: "58vh" }}>
        {!messages && <Spinner />}
        {messages?.map((m) => {
          const mine = m.direction === "out";
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm shadow-sm ${mine ? "bg-green-50 ring-1 ring-green-200" : "bg-white ring-1 ring-slate-200"}`}>
                {m.media && <MediaLabel media={m.media} />}
                {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                <div className="mt-1 flex items-center justify-end gap-1.5 text-[11px] text-slate-400">
                  {mine && <span>{m.sender === "ai" ? "AI assistant" : nameOf(people, m.sent_by) || "Staff"} ·</span>}
                  <span>{time(m.created_at)}</span>
                  {mine && <StatusTick status={m.status} />}
                </div>
                {m.status === "failed" && <div className="mt-1 text-xs text-red-600">Not sent: {m.error}</div>}
              </div>
            </div>
          );
        })}
        {messages?.length === 0 && <Empty>No messages yet.</Empty>}
        <div ref={bottom} />
      </div>

      <div className="space-y-2 border-t border-slate-100 p-3">
        {error && <Alert>{error}</Alert>}
        {!canWrite ? (
          <p className="text-xs text-slate-500">Read-only: the subscription is not active.</p>
        ) : windowOpen ? (
          <>
            <div className="flex gap-2">
              <textarea
                rows={2}
                className="block w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15"
                placeholder="Type a reply…"
                value={text}
                maxLength={4096}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!busy) send();
                  }
                }}
              />
              <Button onClick={send} disabled={busy || !text.trim()}>{busy ? "Sending…" : "Send"}</Button>
            </div>
            <p className="text-[11px] text-slate-400">
              Enter sends, Shift+Enter adds a line. You can reply until {closesAt?.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.
            </p>
          </>
        ) : (
          <Alert tone="info">
            The 24-hour reply window has closed. WhatsApp only lets businesses reply within 24 hours of the customer's last message.
            Message templates for this come with the automation phase; for now, call the customer.
          </Alert>
        )}
      </div>
    </section>
  );
}

function MediaLabel({ media }: { media: unknown }) {
  const kind = (media as { kind?: string } | null)?.kind ?? "file";
  const labels: Record<string, string> = {
    image: "Photo", video: "Video", audio: "Voice note", document: "Document", sticker: "Sticker",
    location: "Location", contacts: "Contact card",
  };
  return <div className="mb-1 text-xs font-semibold text-slate-500">[{labels[kind] ?? "Attachment"}, open WhatsApp on the phone to view]</div>;
}

function StatusTick({ status }: { status: string }) {
  if (status === "sending") return <span title="Sending">…</span>;
  if (status === "failed") return <span className="text-red-500" title="Not sent">!</span>;
  if (status === "read") return <span className="text-sky-500" title="Read">✓✓</span>;
  if (status === "delivered") return <span title="Delivered">✓✓</span>;
  return <span title="Sent">✓</span>;
}

function LeadSide({ slug, chat, lead, people }: { slug: string; chat: Chat; lead: LeadInfo | null; people: ReturnType<typeof useMembers> }) {
  if (!chat.lead_id) return <p className="text-sm text-slate-500">No lead is linked to this chat.</p>;
  if (!lead) return <Spinner />;
  const stage = lead.stage as Stage;
  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Lead</div>
        <div className="mt-1 text-base font-semibold">{lead.name}</div>
        <div className="text-sm text-slate-500">{lead.phone}</div>
      </div>
      <dl className="grid grid-cols-[90px_1fr] gap-y-1.5 text-sm">
        <dt className="text-slate-500">Stage</dt>
        <dd><Badge tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage] ?? lead.stage}</Badge></dd>
        <dt className="text-slate-500">Source</dt>
        <dd>{lead.source}</dd>
        <dt className="text-slate-500">Assigned</dt>
        <dd>{nameOf(people, lead.assigned_to) || "Not assigned"}</dd>
        <dt className="text-slate-500">Follow-up</dt>
        <dd>{lead.follow_up_at ? new Date(lead.follow_up_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "None"}</dd>
      </dl>
      {lead.last_remark && (
        <div className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
          <div className="mb-0.5 font-semibold text-slate-500">Latest note</div>
          {lead.last_remark}
        </div>
      )}
      <Link to={`/w/${slug}/leads?open=${lead.id}`} className="inline-flex w-full justify-center rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50">
        Open lead
      </Link>
    </div>
  );
}
