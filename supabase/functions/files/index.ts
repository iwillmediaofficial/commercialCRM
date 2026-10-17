// File storage on Cloudflare R2. The bucket is private; this function is the
// only thing holding the R2 keys. Every object lives under "<workspace_id>/",
// and every object has a row in public.files that RLS guards, so a person can
// only upload to, open or delete files of companies they belong to.
//
// POST multipart/form-data { workspace_id, entity_type, entity_id?, file }
//   -> { file: <files row> }            upload (signed in)
// POST { action: "url", key | file_id } -> { url }   short-lived download link (signed in)
// POST { action: "delete", file_id }    -> { ok }    (signed in)
// POST { action: "public_form", slug }  -> { logo, banner }   branding for a public lead form (no sign-in)
// POST { action: "health" }             -> { ok, bucket }  checks the R2 keys can reach the bucket (no data returned)
//
// Secrets (Supabase > Edge Functions > Secrets): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
// R2_SECRET_ACCESS_KEY, R2_BUCKET.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const R2_ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID");
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY");
const R2_BUCKET = Deno.env.get("R2_BUCKET");

const MAX_BYTES = 20 * 1024 * 1024;
const LINK_SECONDS = 600;
const ENTITY_TYPES = ["work_item", "client", "lead", "invoice", "workspace", "profile", "renewal", "lead_form"];
// Attachments the Super Admin switches on per company (workspaces.attachments_enabled).
const ATTACHMENT_TYPES = ["work_item", "client", "lead", "invoice"];
// No HTML, SVG or scripts: they could run code when opened.
const ALLOWED = /^(image\/(png|jpe?g|gif|webp|heic|heif)|application\/pdf|text\/(plain|csv)|application\/(zip|x-zip-compressed|msword|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.[a-z.]+)|video\/(mp4|quicktime|webm)|audio\/(mpeg|mp4|ogg|wav))$/;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
const fail = (status: number, message: string) => reply(status, { ok: false, message });

const r2 = R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET
  ? new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" })
  : null;

function objectUrl(key: string) {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${path}`;
}

async function signedGet(key: string, fileName?: string, mime?: string | null) {
  const url = new URL(objectUrl(key));
  url.searchParams.set("X-Amz-Expires", String(LINK_SECONDS));
  if (fileName) {
    const inline = mime?.startsWith("image/") || mime === "application/pdf" || mime?.startsWith("video/") || mime?.startsWith("audio/");
    url.searchParams.set(
      "response-content-disposition",
      `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
  }
  const signed = await r2!.sign(new Request(url, { method: "GET" }), { aws: { signQuery: true } });
  return signed.url;
}

function safeName(name: string) {
  const cleaned = name.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").replace(/^[.-]+/, "");
  return (cleaned || "file").slice(-100);
}

const service = () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// A client that acts as the caller, so RLS decides what they may touch.
async function asCaller(req: Request): Promise<{ db: SupabaseClient; userId: string } | null> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const db = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data } = await db.auth.getUser(auth.slice(7));
  return data.user ? { db, userId: data.user.id } : null;
}

async function upload(req: Request) {
  const caller = await asCaller(req);
  if (!caller) return fail(401, "Sign in again.");
  const form = await req.formData();
  const file = form.get("file");
  const workspaceId = String(form.get("workspace_id") ?? "");
  const entityType = String(form.get("entity_type") ?? "");
  const entityId = form.get("entity_id") ? String(form.get("entity_id")) : null;
  if (!(file instanceof File) || !workspaceId || !ENTITY_TYPES.includes(entityType)) return fail(400, "Choose a file.");
  if (file.size === 0) return fail(400, "That file is empty.");
  if (file.size > MAX_BYTES) return fail(400, "Files can be up to 20 MB.");
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED.test(mime)) return fail(400, "That type of file can't be uploaded. Use images, PDFs, Office files, text, zip, audio or video.");

  // Check write access before sending anything to R2.
  // Renewal receipts are allowed after the plan has ended (but not when suspended).
  const { data: allowed } = entityType === "renewal"
    ? await caller.db.rpc("is_workspace_admin", { ws: workspaceId })
    : await caller.db.rpc("can_write", { ws: workspaceId });
  if (!allowed) return fail(403, "You can't upload files to this company right now.");
  if (ATTACHMENT_TYPES.includes(entityType)) {
    const { data: ws } = await caller.db.from("workspaces").select("attachments_enabled").eq("id", workspaceId).maybeSingle();
    if (!ws?.attachments_enabled) return fail(403, "File uploads are turned off for this company.");
  }

  const key = `${workspaceId}/${entityType}/${crypto.randomUUID()}/${safeName(file.name)}`;
  const put = await r2!.fetch(objectUrl(key), {
    method: "PUT",
    body: await file.arrayBuffer(),
    headers: { "Content-Type": mime },
  });
  if (!put.ok) {
    console.error("R2 put failed", put.status, await put.text());
    return fail(502, "The upload didn't go through. Try again.");
  }

  const { data: row, error } = await caller.db
    .from("files")
    .insert({
      workspace_id: workspaceId,
      entity_type: entityType,
      entity_id: entityId,
      r2_key: key,
      file_name: file.name.slice(0, 200),
      mime_type: mime,
      size_bytes: file.size,
      uploaded_by: caller.userId,
    })
    .select()
    .single();
  if (error) {
    await r2!.fetch(objectUrl(key), { method: "DELETE" });
    return fail(403, error.message);
  }
  return reply(200, { ok: true, file: row });
}

async function link(req: Request, body: { key?: string; file_id?: string }) {
  const caller = await asCaller(req);
  if (!caller) return fail(401, "Sign in again.");
  let q = caller.db.from("files").select("r2_key, file_name, mime_type");
  q = body.file_id ? q.eq("id", body.file_id) : q.eq("r2_key", body.key ?? "");
  const { data } = await q.maybeSingle();
  if (!data) return fail(404, "That file isn't available.");
  return reply(200, { ok: true, url: await signedGet(data.r2_key, data.file_name, data.mime_type) });
}

async function remove(req: Request, body: { file_id?: string }) {
  const caller = await asCaller(req);
  if (!caller) return fail(401, "Sign in again.");
  const { data, error } = await caller.db.from("files").delete().eq("id", body.file_id ?? "").select("r2_key");
  if (error) return fail(403, error.message);
  if (!data?.length) return fail(403, "You can't delete this file.");
  await r2!.fetch(objectUrl(data[0].r2_key), { method: "DELETE" });
  return reply(200, { ok: true });
}

// Branding for a public lead form: only active forms, only their own images.
async function publicForm(body: { slug?: string }) {
  const db = service();
  const { data: f } = await db
    .from("lead_forms")
    .select("workspace_id, logo_path, banner_path, is_active")
    .eq("slug", body.slug ?? "")
    .maybeSingle();
  if (!f?.is_active) return reply(200, { ok: true, logo: null, banner: null });
  const { data: s } = await db.from("workspace_settings").select("logo_path").eq("workspace_id", f.workspace_id).maybeSingle();
  const own = (k: string | null | undefined) => (k && k.startsWith(`${f.workspace_id}/`) ? k : null);
  const logoKey = own(f.logo_path) ?? own(s?.logo_path);
  const bannerKey = own(f.banner_path);
  return reply(200, {
    ok: true,
    logo: logoKey ? await signedGet(logoKey) : null,
    banner: bannerKey ? await signedGet(bannerKey) : null,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "Use POST.");
  if (!r2) return fail(503, "File storage isn't set up yet. Ask the Super Admin.");
  try {
    if ((req.headers.get("Content-Type") ?? "").startsWith("multipart/form-data")) return await upload(req);
    const body = await req.json();
    switch (body?.action) {
      case "url":
        return await link(req, body);
      case "delete":
        return await remove(req, body);
      case "public_form":
        return await publicForm(body);
      case "health": {
        const r = await r2.fetch(`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}?list-type=2&max-keys=1`);
        await r.body?.cancel();
        return reply(r.ok ? 200 : 502, { ok: r.ok, bucket: r.ok ? "reachable" : `R2 said ${r.status}` });
      }
      default:
        return fail(400, "Unknown action.");
    }
  } catch (e) {
    console.error(e);
    return fail(500, "Something went wrong with the file. Try again.");
  }
});
