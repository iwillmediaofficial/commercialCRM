// A company's lead link: anything POSTed here becomes a live lead.
// Deployed with verify_jwt off; the secret key in the address is the check.
//
//   POST /functions/v1/lead-link?key=<key>
//     JSON: one lead { "full_name": "...", "phone_number": "...", ... },
//           a list [ {...}, {...} ], or { "leads": [ ... ] } (up to 50)
//           Meta's format { "field_data": [{ "name": "...", "values": ["..."] }] } works too.
//           { "test": true } checks the connection without adding a lead.
//     Form posts (x-www-form-urlencoded / multipart) are one lead.
//   GET  /functions/v1/lead-link?key=<key>   says whether the link works.
//
// Answers: 200 { ok, added, duplicates, rejected, tests, results }
//          404 wrong key · 410 link turned off · 403 company can't take leads
//          413 too big · 429 too many (try again later) · 400 bad request
import { createClient } from "npm:@supabase/supabase-js@2";
import { flatten, mapLead } from "../_shared/lead_fields.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_BODY = 200_000;
const MAX_LEADS = 50;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function keyFrom(url: URL) {
  const q = url.searchParams.get("key");
  if (q) return q.trim();
  const parts = url.pathname.split("/").filter(Boolean);
  const i = parts.indexOf("lead-link");
  return i >= 0 && parts[i + 1] ? parts[i + 1].trim() : "";
}

function viaFrom(req: Request, url: URL, body: unknown) {
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const given = (typeof b.via === "string" && b.via) || url.searchParams.get("via");
  if (given) return given.slice(0, 40);
  const ua = (req.headers.get("user-agent") ?? "").toLowerCase();
  if (ua.includes("google-apps-script") || ua.includes("google apps script")) return "google-sheet";
  if (ua.includes("zapier")) return "zapier";
  if (ua.includes("integromat") || ua.includes("make.com")) return "make";
  if (ua.includes("pabbly")) return "pabbly";
  return "web";
}

async function readBody(req: Request, raw: string): Promise<unknown> {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (type.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  if (type.includes("multipart/form-data")) {
    const fd = await new Response(raw, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
    const o: Record<string, string> = {};
    fd.forEach((v, k) => { if (typeof v === "string") o[k] = v; });
    return o;
  }
  try {
    return JSON.parse(raw);
  } catch {
    // Some tools send JSON with the wrong type, others send form text.
    if (raw.includes("=")) return Object.fromEntries(new URLSearchParams(raw));
    throw new Error("Send the lead as JSON or as a form.");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const url = new URL(req.url);
  const key = keyFrom(url);
  if (!key || key.length < 20 || key.length > 100) return reply(404, { ok: false, error: "Lead link not found." });

  const { data: link, error } = await admin
    .from("lead_links")
    .select("id, name, is_active, field_map")
    .eq("token", key)
    .maybeSingle();
  if (error) return reply(500, { ok: false, error: "Couldn't check the link. Try again." });
  if (!link) return reply(404, { ok: false, error: "Lead link not found." });
  if (!link.is_active) return reply(410, { ok: false, error: "This lead link is turned off." });

  if (req.method === "GET") return reply(200, { ok: true, link: link.name, message: "This lead link works. Send leads to it with POST." });
  if (req.method !== "POST") return reply(405, { ok: false, error: "Use POST." });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return reply(413, { ok: false, error: "Too much data in one request." });

  let body: unknown;
  try {
    body = await readBody(req, raw);
  } catch (e) {
    return reply(400, { ok: false, error: e instanceof Error ? e.message : "Couldn't read the request." });
  }

  const obj = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const list: unknown[] = Array.isArray(body) ? body : Array.isArray(obj?.leads) ? (obj!.leads as unknown[]) : [body];
  if (list.length === 0) return reply(400, { ok: false, error: "No leads in the request." });
  if (list.length > MAX_LEADS) return reply(413, { ok: false, error: `Send up to ${MAX_LEADS} leads at a time.` });

  const fieldMap = (link.field_map ?? {}) as Record<string, string>;
  const isTest = (v: unknown) => v === true || v === "true" || v === 1 || v === "1";
  const items = list.map((rec) => {
    const r = rec && typeof rec === "object" && !Array.isArray(rec) ? (rec as Record<string, unknown>) : {};
    const test = isTest(r.test) || (obj !== null && isTest(obj.test) && !Array.isArray(obj.leads));
    return mapLead(flatten(r), fieldMap, test);
  });

  const { data, error: rpcError } = await admin.rpc("receive_lead_link", {
    p_link_id: link.id,
    p_items: items,
    p_via: viaFrom(req, url, body),
  });
  if (rpcError) {
    const m = rpcError.message ?? "";
    if (m.includes("not_available")) return reply(403, { ok: false, error: "This company can't receive leads right now." });
    if (m.includes("too_many")) return reply(429, { ok: false, error: "Too many leads in 10 minutes. Try again shortly." });
    return reply(400, { ok: false, error: m || "Couldn't save the lead." });
  }
  return reply(200, { ok: true, ...(data as Record<string, unknown>) });
});
