// Sends a staff reply from the Inbox to WhatsApp. The database decides whether
// this person may reply in this chat (wa_prepare_send, run as them); this
// function holds the Meta token, which the browser never sees.
//
// POST { chat_id, body }   with the signed-in person's Authorization header
//
// Secrets (Supabase → Edge Functions → Secrets):
//   WHATSAPP_ACCESS_TOKEN  permanent System User token from Meta Business settings
//                          (phase 1: one token for the numbers in our own Meta account)
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const GRAPH = "https://graph.facebook.com/v23.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { ok: false, message: "Use POST." });

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return reply(401, { ok: false, message: "Sign in again." });

  let input: { chat_id?: string; body?: string };
  try {
    input = await req.json();
  } catch {
    return reply(400, { ok: false, message: "Bad request." });
  }
  if (!input.chat_id || typeof input.body !== "string") return reply(400, { ok: false, message: "Bad request." });
  if (!ACCESS_TOKEN) return reply(503, { ok: false, message: "WhatsApp is not set up yet (missing access token)." });

  // As the signed-in person, so the database's own checks apply.
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: prep, error: prepErr } = await asUser.rpc("wa_prepare_send", {
    p_chat_id: input.chat_id,
    p_body: input.body,
  });
  if (prepErr || !prep) return reply(400, { ok: false, message: prepErr?.message ?? "Could not send." });

  const { message_id, phone_number_id, to } = prep as { message_id: string; phone_number_id: string; to: string };
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  let waId: string | null = null;
  let failure: string | null = null;
  try {
    const res = await fetch(`${GRAPH}/${phone_number_id}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: true, body: input.body.trim() },
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (res.ok) waId = out?.messages?.[0]?.id ?? null;
    else failure = out?.error?.error_data?.details ?? out?.error?.message ?? `WhatsApp said ${res.status}`;
  } catch (e) {
    failure = `Could not reach WhatsApp: ${(e as Error).message}`;
  }

  await admin.rpc("wa_finish_send", { p_message_id: message_id, p_wa_message_id: waId, p_error: failure });
  if (failure) return reply(502, { ok: false, message: failure, message_id });
  return reply(200, { ok: true, message_id });
});
