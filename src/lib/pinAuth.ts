import { supabase } from "./supabase";

type Result = { ok: true; workspace_id?: string | null } | { ok: false; message: string };

// Calls the pin-auth Edge Function. It answers 400 with a friendly message for
// a wrong PIN, so read the body whatever the status.
async function call(body: Record<string, unknown>): Promise<Result> {
  const { data, error } = await supabase.functions.invoke("pin-auth", { body });
  if (data?.ok) return { ok: true, workspace_id: data.workspace_id };
  const context = (error as { context?: Response } | null)?.context;
  if (context && typeof context.json === "function") {
    try {
      const parsed = await context.json();
      if (parsed?.message) return { ok: false, message: parsed.message };
    } catch {
      /* fall through */
    }
  }
  return { ok: false, message: data?.message ?? "Something went wrong. Try again." };
}

export function signUpWithPin(input: {
  email: string;
  password: string;
  pin: string;
  full_name: string;
  phone?: string;
  purpose?: "signup" | "platform_admin";
}) {
  return call({ action: "signup", ...input });
}

export function resetWithPin(input: { email: string; pin: string; password: string }) {
  return call({ action: "reset", ...input });
}
