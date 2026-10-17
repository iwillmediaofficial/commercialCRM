import { supabase } from "./supabase";

// Sends app crashes to the Super Admin's Errors tab. Never throws.
const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? "dev";
const DEDUPE_MS = 30_000;
const recent = new Map<string, number>();

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: error.message || error.name, stack: error.stack };
  if (typeof error === "string") return { message: error };
  if (error && typeof error === "object") {
    const o = error as { message?: unknown; status?: unknown; statusText?: unknown; stack?: unknown };
    if (typeof o.message === "string") return { message: o.message, stack: typeof o.stack === "string" ? o.stack : undefined };
    if (o.status != null) return { message: `${o.status} ${o.statusText ?? ""}`.trim() };
    try {
      return { message: JSON.stringify(error).slice(0, 1000) };
    } catch {
      /* fall through */
    }
  }
  return { message: String(error) };
}

function isNoise(message: string, stack?: string) {
  if (/ResizeObserver loop/i.test(message)) return true;
  if (/(chrome|moz|safari(-web)?)-extension:\/\//.test(stack ?? "")) return true;
  return false;
}

export function reportError(error: unknown, context?: { workspaceId?: string }) {
  try {
    const { message, stack } = describe(error);
    if (!message || isNoise(message, stack)) return;
    const now = Date.now();
    const last = recent.get(message);
    if (last && now - last < DEDUPE_MS) return;
    recent.set(message, now);
    if (recent.size > 100) {
      for (const [k, t] of recent) if (now - t >= DEDUPE_MS) recent.delete(k);
    }
    void supabase
      .rpc("log_client_error", {
        p_message: message.slice(0, 2000),
        p_stack: stack?.slice(0, 8000),
        p_url: window.location.href,
        p_user_agent: navigator.userAgent,
        p_workspace_id: context?.workspaceId,
        p_app_version: APP_VERSION,
      })
      .then(
        () => undefined,
        () => undefined,
      );
  } catch {
    // Reporting must never break the app.
  }
}

let installed = false;
export function installErrorReporting() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    // Resource load failures (img, script) have no error object; skip them.
    if (!e.error && !e.message) return;
    if (e.filename && /^(chrome|moz|safari(-web)?)-extension:/.test(e.filename)) return;
    reportError(e.error ?? e.message);
  });
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason));
}
