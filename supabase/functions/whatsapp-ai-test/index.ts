// "Test the assistant" on the WhatsApp AI settings page: an admin types as if
// they were a customer and sees what the assistant would reply. Nothing goes to
// WhatsApp and no lead changes; the tokens count towards the month's AI use.
//
// POST { workspace_id, messages: [{ sender: "customer" | "ai", body }] }
import { createClient } from "npm:@supabase/supabase-js@2";
import { aiConfigured, askAssistant, systemPrompt, toMessages, type AiSettings, type AiTurn } from "../_shared/wa_ai.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { ok: false, message: "Use POST." });
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return reply(401, { ok: false, message: "Sign in again." });

  let input: { workspace_id?: string; messages?: AiTurn[] };
  try {
    input = await req.json();
  } catch {
    return reply(400, { ok: false, message: "Bad request." });
  }
  const turns = (Array.isArray(input.messages) ? input.messages : [])
    .filter((m) => m && typeof m.body === "string" && m.body.trim())
    .slice(-20)
    .map((m) => ({ sender: m.sender === "customer" ? "customer" : "ai", body: m.body.slice(0, 2000) }));
  if (!input.workspace_id || !turns.length) return reply(400, { ok: false, message: "Type a message first." });
  if (!aiConfigured()) {
    return reply(503, { ok: false, message: "The AI key is not set up yet. The Super Admin adds ANTHROPIC_API_KEY in Supabase." });
  }

  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: ctx, error } = await asUser.rpc("wa_ai_test_context", { p_workspace_id: input.workspace_id });
  if (error || !ctx) return reply(403, { ok: false, message: error?.message ?? "Not allowed." });

  const result = await askAssistant(systemPrompt(ctx.company as string, ctx.settings as AiSettings), toMessages(turns));

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  if (result.input_tokens || result.output_tokens) {
    await admin.rpc("wa_ai_add_test_usage", {
      p_workspace_id: input.workspace_id, p_input_tokens: result.input_tokens, p_output_tokens: result.output_tokens,
    });
  }
  if (result.error) return reply(502, { ok: false, message: `The assistant had a problem: ${result.error}` });
  return reply(200, {
    ok: true,
    reply: result.reply,
    handoff: result.handoff,
    handoff_reason: result.handoff_reason,
    customer_name: result.customer_name,
    answers: result.answers,
    summary: result.summary,
  });
});
