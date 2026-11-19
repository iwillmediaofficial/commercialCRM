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
import { createClient } from "npm:@supabase/supabase-js@2";

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
