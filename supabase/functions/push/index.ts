// Phone alerts (Web Push). Deployed with verify_jwt off.
//
//   GET  /functions/v1/push
//        { publicKey } – the VAPID public key browsers subscribe with.
//        The key pair is made on first use and kept in private.app_secrets.
//   POST /functions/v1/push { "notification_id": "<uuid>" }
//        Called by the database for each new notification. Sends it once to
//        every device of its person. Only notifications from the last
//        10 minutes that were never pushed are sent, so a replayed or guessed
//        call can't spam anyone.
//   POST /functions/v1/push { "test": true }  (with the signed-in person's token)
//        Sends a test alert to the caller's own devices.
import { createClient } from "npm:@supabase/supabase-js@2";
import { generateVapidKeys, sendPush, type VapidKeys } from "../_shared/webpush.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUBJECT = Deno.env.get("PUSH_SUBJECT") ?? "https://iwillcrm.in";

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

let keysCache: VapidKeys | null = null;
async function getKeys(): Promise<VapidKeys> {
  if (keysCache) return keysCache;
  const read = async () => {
    const { data, error } = await admin.rpc("push_get_keys");
    if (error) throw error;
    const k = data as { public: string | null; private: string | null };
    return k.public && k.private ? { publicKey: k.public, privateJwk: JSON.parse(k.private) as JsonWebKey } : null;
  };
  let keys = await read();
  if (!keys) {
    const made = await generateVapidKeys();
    const { error } = await admin.rpc("push_store_keys", { p_public: made.publicKey, p_private: JSON.stringify(made.privateJwk) });
    if (error) throw error;
    keys = await read(); // another call may have stored its pair first
  }
  if (!keys) throw new Error("No push keys");
  keysCache = keys;
  return keys;
}

// Same rule as the bell: links are workspace-relative unless they start with /w/.
function target(slug: string | null, link: string | null) {
  if (!link) return slug ? `/w/${slug}` : "/";
  if (link.startsWith("/w/") || !slug) return link.startsWith("/") ? link : `/${link}`;
  const path = link.replace(/^\/+/, "").replace(/^settings\/subscription$/, "billing");
  return `/w/${slug}/${path}`;
}

type Message = { title: string; body: string; url: string; tag: string };

async function sendToUser(userId: string, message: Message) {
  const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId);
  if (!subs?.length) return { sent: 0, devices: 0 };
  const keys = await getKeys();
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        const status = await sendPush(s, message, keys, SUBJECT);
        if (status === 404 || status === 410) {
          await admin.from("push_subscriptions").delete().eq("id", s.id);
        } else if (status >= 200 && status < 300) {
          sent++;
          await admin.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).eq("id", s.id);
        } else {
          console.warn("push failed", status, new URL(s.endpoint).host);
        }
      } catch (e) {
        console.warn("push error", String(e));
      }
    }),
  );
  return { sent, devices: subs.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    if (req.method === "GET") {
      const keys = await getKeys();
      return reply(200, { publicKey: keys.publicKey });
    }
    if (req.method !== "POST") return reply(405, { error: "Method not allowed" });

    let body: { notification_id?: string; test?: boolean };
    try {
      body = await req.json();
    } catch {
      return reply(400, { error: "Bad JSON" });
    }

    if (body.test) {
      const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data: who } = token ? await admin.auth.getUser(token) : { data: { user: null } };
      if (!who.user) return reply(401, { error: "Sign in first" });
      const result = await sendToUser(who.user.id, {
        title: "Phone alerts are on",
        body: "You'll get new leads and follow-up reminders here.",
        url: "/",
        tag: "push-test",
      });
      return reply(200, result);
    }

    const id = body.notification_id;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return reply(400, { error: "notification_id needed" });

    // Claim it: only once, and only while it is fresh.
    const { data: note } = await admin
      .from("notifications")
      .update({ pushed_at: new Date().toISOString() })
      .eq("id", id)
      .is("pushed_at", null)
      .gt("created_at", new Date(Date.now() - 10 * 60_000).toISOString())
      .select("id, user_id, workspace_id, title, message, link")
      .maybeSingle();
    if (!note) return reply(200, { sent: 0, skipped: true });

    let slug: string | null = null;
    if (note.workspace_id) {
      const { data: ws } = await admin.from("workspaces").select("slug").eq("id", note.workspace_id).maybeSingle();
      slug = ws?.slug ?? null;
    }
    const result = await sendToUser(note.user_id, {
      title: note.title,
      body: note.message ?? "",
      url: target(slug, note.link),
      tag: note.id,
    });
    return reply(200, result);
  } catch (e) {
    console.error("push", e);
    return reply(500, { error: "Something went wrong" });
  }
});
