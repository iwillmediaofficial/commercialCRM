// PIN sign-up and password reset. There are no emails in this product: a
// Super Admin or company admin hands out a one-time PIN, and this function
// checks it, creates or updates the account, and marks the PIN used.
//
// POST { action: "signup", email, password, pin, full_name?, phone?, purpose? }
//   purpose is "signup" (join a company, the default) or "platform_admin".
//   If the email already has an account, the password must match it and the
//   PIN simply adds the company to that account.
// POST { action: "reset", email, pin, password }
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MESSAGES: Record<string, string> = {
  invalid_pin: "That PIN is not valid. Check it, or ask your admin for a new one.",
  too_many_attempts: "Too many wrong tries. Wait 15 minutes and try again.",
  workspace_inactive: "This company's subscription is not active. Ask the owner to renew.",
  account_exists: "This email already has an account. Enter that account's password to add the company to it.",
  weak_password: "Use a password of at least 8 characters.",
  seat_limit: "This company has used all the staff seats on its plan. Ask the owner to free a seat or upgrade.",
  owner_exists: "This company already has an owner. Sign in with the owner's account, or ask the Super Admin.",
  bad_request: "Fill in every required field.",
  failed: "Something went wrong. Try again, or ask your admin for a new PIN.",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function fail(code: keyof typeof MESSAGES, status = 400) {
  return reply(status, { ok: false, error: code, message: MESSAGES[code] });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("bad_request", 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("bad_request");
  }

  const action = String(body.action ?? "");
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const pin = String(body.pin ?? "").trim().toUpperCase().replace(/[\s-]/g, "");
  const clientKey =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown";

  if (!email.includes("@") || !pin || !password) return fail("bad_request");
  if (password.length < 8) return fail("weak_password");

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (action === "signup") {
    const purpose = body.purpose === "platform_admin" ? "platform_admin" : "signup";
    const fullName = String(body.full_name ?? "").trim();
    const phone = String(body.phone ?? "").trim() || null;

    const { data: check, error: checkErr } = await admin.rpc("pin_check", {
      p_pin: pin, p_email: email, p_purpose: purpose, p_client_key: clientKey,
    });
    if (checkErr) return fail("failed", 500);
    if (!check?.ok) return fail(check?.error ?? "invalid_pin");

    let userId: string;
    let created = false;
    const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (newUser?.user) {
      userId = newUser.user.id;
      created = true;
    } else if (createErr && /already|exists|registered/i.test(createErr.message)) {
      // Existing account: prove it is theirs before adding the company to it.
      const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      const { data: signIn } = await anon.auth.signInWithPassword({ email, password });
      if (!signIn?.user) return fail("account_exists");
      userId = signIn.user.id;
    } else {
      return fail("failed", 500);
    }

    const { data: consumed, error: consumeErr } = await admin.rpc("pin_consume", {
      p_pin_id: check.pin_id, p_user_id: userId, p_email: email,
      p_full_name: fullName, p_phone: phone, p_client_key: clientKey,
    });
    if (consumeErr || !consumed?.ok) {
      if (created) await admin.auth.admin.deleteUser(userId);
      if (consumeErr?.hint === "seat_limit") return fail("seat_limit");
      if (consumeErr?.code === "23505") return fail("owner_exists");
      return fail("invalid_pin");
    }
    return reply(200, { ok: true, workspace_id: consumed.workspace_id, role: consumed.role });
  }

  if (action === "reset") {
    const { data: check, error: checkErr } = await admin.rpc("pin_check", {
      p_pin: pin, p_email: email, p_purpose: "reset", p_client_key: clientKey,
    });
    if (checkErr) return fail("failed", 500);
    if (!check?.ok) return fail(check?.error ?? "invalid_pin");

    // Use the PIN first so it can never work twice, then set the password.
    const { data: consumed, error: consumeErr } = await admin.rpc("pin_consume", {
      p_pin_id: check.pin_id, p_user_id: check.target_user_id, p_email: email, p_client_key: clientKey,
    });
    if (consumeErr || !consumed?.ok) return fail("invalid_pin");

    const { error: updErr } = await admin.auth.admin.updateUserById(check.target_user_id, { password });
    if (updErr) return fail("failed", 500);
    return reply(200, { ok: true });
  }

  return fail("bad_request");
});
