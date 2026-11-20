// Receives WhatsApp events from Meta (Cloud API webhook). Deployed with
// verify_jwt off: Meta can't send a Supabase token, so every POST is checked
// against Meta's signature instead.
//
// GET  ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...  (one-time setup in Meta)
// POST { object: "whatsapp_business_account", entry: [...] }        (messages and receipts)
//
// Secrets (Supabase → Edge Functions → Secrets):
//   WHATSAPP_VERIFY_TOKEN  any long random text, typed the same in Meta's webhook setup
//   WHATSAPP_APP_SECRET    Meta app → App settings → Basic → App secret
//   ANTHROPIC_API_KEY      for AI replies (phase 2), see ../_shared/wa_ai.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { askAssistant, sendWhatsAppText, systemPrompt, toMessages, type AiSettings, type AiTurn } from "../_shared/wa_ai.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function hex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time compare of Meta's "sha256=<hex>" header with our own HMAC.
async function validSignature(raw: string, header: string | null) {
  if (!APP_SECRET || !header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mine = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const theirs = header.slice(7).toLowerCase();
  if (mine.length !== theirs.length) return false;
  let diff = 0;
  for (let i = 0; i < mine.length; i++) diff |= mine.charCodeAt(i) ^ theirs.charCodeAt(i);
  return diff === 0;
}

type WaMessage = {
  id: string;
  from: string;
  timestamp?: string;
  type: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string; mime_type?: string };
  video?: { id?: string; caption?: string; mime_type?: string };
  document?: { id?: string; caption?: string; filename?: string; mime_type?: string };
  audio?: { id?: string; mime_type?: string; voice?: boolean };
  sticker?: { id?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  contacts?: { name?: { formatted_name?: string } }[];
};

// Text to show for each kind of message. Files stay on Meta for now (shown as a label).
function describe(m: WaMessage): { body: string | null; media: Record<string, unknown> | null } {
  switch (m.type) {
    case "text":
      return { body: m.text?.body ?? "", media: null };
    case "image":
    case "video":
    case "document":
    case "audio":
    case "sticker": {
      const part = (m as Record<string, unknown>)[m.type] as Record<string, unknown> | undefined;
      const caption = (part?.caption as string | undefined) ?? (part?.filename as string | undefined) ?? null;
      return { body: caption, media: part ? { kind: m.type, ...part } : { kind: m.type } };
    }
    case "location": {
      const l = m.location ?? {};
      const words = [l.name, l.address].filter(Boolean).join(", ");
      return { body: words || `Location ${l.latitude}, ${l.longitude}`, media: { kind: "location", ...l } };
    }
    case "button":
      return { body: m.button?.text ?? null, media: null };
    case "interactive":
      return { body: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null, media: null };
    case "contacts":
      return { body: `Contact: ${m.contacts?.[0]?.name?.formatted_name ?? "shared"}`, media: { kind: "contacts" } };
    default:
      return { body: null, media: { kind: m.type } };
  }
}

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Customers often send several short messages in a row. Wait a moment, and only
// the newest message of the burst gets an answer (covering all of them).
const SETTLE_MS = 4000;

async function aiReply(chatId: string, messageId: string) {
  await sleep(SETTLE_MS);
  const { data: latest } = await admin
    .from("wa_messages")
    .select("id")
    .eq("chat_id", chatId)
    .eq("direction", "in")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest?.id !== messageId) return;

  const { data: ctx, error } = await admin.rpc("wa_ai_context", { p_chat_id: chatId });
  if (error) return console.error("wa_ai_context failed", error.message);
  if (!ctx) return; // AI off for this chat
  if (ctx.limit_reached) {
    await admin.rpc("wa_ai_record", {
      p_chat_id: chatId, p_reply: null, p_handoff: true,
      p_handoff_reason: "This month's AI chat allowance is used up", p_customer_name: null,
      p_answers: null, p_summary: null, p_input_tokens: 0, p_output_tokens: 0,
    });
    return;
  }

  const lead = ctx.lead as { name?: string; form_answers?: unknown } | null;
  const chat = ctx.chat as { contact_name?: string | null; ai_summary?: string | null };
  const system = systemPrompt(ctx.company as string, ctx.settings as AiSettings, {
    name: lead?.name && !lead.name.startsWith("+") ? lead.name : chat.contact_name,
    answers: lead?.form_answers,
    summary: chat.ai_summary,
  });
  const result = await askAssistant(system, toMessages(ctx.messages as AiTurn[]));
  if (result.error) console.warn("AI reply failed, handing off", chatId, result.error);

  const { data: out, error: recErr } = await admin.rpc("wa_ai_record", {
    p_chat_id: chatId,
    p_reply: result.reply || null,
    p_handoff: result.handoff,
    p_handoff_reason: result.handoff_reason || null,
    p_customer_name: result.customer_name || null,
    p_answers: result.answers,
    p_summary: result.summary || null,
    p_input_tokens: result.input_tokens,
    p_output_tokens: result.output_tokens,
  });
  if (recErr) return console.error("wa_ai_record failed", recErr.message);
  const send = out as { message_id: string; phone_number_id: string | null; to: string } | null;
  if (!send) return; // nothing to send, or a person took over meanwhile
  const { waId, failure } = send.phone_number_id
    ? await sendWhatsAppText(send.phone_number_id, send.to, result.reply)
    : { waId: null, failure: "This company's WhatsApp number is not active." };
  await admin.rpc("wa_finish_send", { p_message_id: send.message_id, p_wa_message_id: waId, p_error: failure });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const ok = VERIFY_TOKEN && url.searchParams.get("hub.mode") === "subscribe" &&
      url.searchParams.get("hub.verify_token") === VERIFY_TOKEN;
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 })
      : new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = await req.text();
  if (!(await validSignature(raw, req.headers.get("x-hub-signature-256")))) {
    return new Response("Bad signature", { status: 401 });
  }

  let payload: { object?: string; entry?: { changes?: { field?: string; value?: Record<string, unknown> }[] }[] };
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  // Meta retries anything that isn't a 200, so errors are logged and the batch still answers 200.
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages" || !change.value) continue;
      const value = change.value as {
        metadata?: { phone_number_id?: string };
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: WaMessage[];
        statuses?: { id: string; status: string; errors?: { title?: string; message?: string }[] }[];
      };
      const phoneNumberId = value.metadata?.phone_number_id ?? "";

      for (const m of value.messages ?? []) {
        const contact = value.contacts?.find((c) => c.wa_id === m.from) ?? value.contacts?.[0];
        const { body, media } = describe(m);
        const sentAt = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : null;
        const { data, error } = await admin.rpc("wa_receive", {
          p_phone_number_id: phoneNumberId,
          p_wa_id: m.from,
          p_name: contact?.profile?.name ?? null,
          p_wa_message_id: m.id,
          p_type: m.type,
          p_body: body,
          p_media: media,
          p_sent_at: sentAt,
        });
        if (error) console.error("wa_receive failed", error.message);
        else if (data && !data.ok) console.warn("wa_receive skipped", data.reason, phoneNumberId);
        else if (data?.chat_id && data?.message_id) {
          // Answer after Meta has its 200; the function stays alive for the background job.
          EdgeRuntime.waitUntil(aiReply(data.chat_id, data.message_id).catch((e) => console.error("aiReply", e)));
        }
      }

      for (const s of value.statuses ?? []) {
        const err = s.errors?.[0];
        const { error } = await admin.rpc("wa_status", {
          p_wa_message_id: s.id,
          p_status: s.status,
          p_error: err ? (err.message ?? err.title ?? null) : null,
        });
        if (error) console.error("wa_status failed", error.message);
      }
    }
  }

  return new Response("ok", { status: 200 });
});
