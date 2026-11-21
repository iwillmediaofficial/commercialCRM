import { useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// Installable app: service worker, the "Install app" prompt, and phone alerts.
// ---------------------------------------------------------------------------

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

// Called once from main.tsx, before React renders.
export function setupPwa() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own button instead of Chrome's mini bar
    deferred = e as InstallPrompt;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    });
    // The browser swapped this device's push address: save the new one.
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data?.type === "push-resubscribe") enablePush().catch(() => {});
    });
  }
}

export type InstallState =
  | { kind: "installed" }
  | { kind: "prompt"; install: () => Promise<boolean> } // Android / desktop Chrome / Edge
  | { kind: "ios" } // Safari: Share > Add to Home Screen
  | { kind: "unavailable" }; // browser can't install, or already offered and declined

export function useInstall(): InstallState {
  const prompt = useSyncExternalStore(subscribe, () => deferred);
  if (isStandalone()) return { kind: "installed" };
  if (prompt) {
    return {
      kind: "prompt",
      install: async () => {
        await prompt.prompt();
        const { outcome } = await prompt.userChoice;
        deferred = null;
        notify();
        return outcome === "accepted";
      },
    };
  }
  if (isIos()) return { kind: "ios" };
  return { kind: "unavailable" };
}

// ---------------------------------------------------------------------------
// Phone alerts (Web Push)
// ---------------------------------------------------------------------------

const PUSH_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/push`;

export type PushState = "unsupported" | "needs-install" | "blocked" | "off" | "on" | "loading";

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function keyBytes(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? "Android" : isIos() ? "iPhone/iPad" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : "Other";
  return `${os}${isStandalone() ? " app" : " browser"}`;
}

async function registration() {
  const existing = await navigator.serviceWorker.getRegistration("/");
  return existing ?? navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
}

async function currentPushState(): Promise<PushState> {
  if (!pushSupported()) return isIos() && !isStandalone() ? "needs-install" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

// Asks for permission (must be called from a tap) and saves this device.
export async function enablePush() {
  if (!pushSupported()) throw new Error("This browser can't show phone alerts.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Alerts were not allowed. You can allow them in the browser's site settings.");
  const res = await fetch(PUSH_URL);
  const { publicKey } = (await res.json()) as { publicKey?: string };
  if (!publicKey) throw new Error("Couldn't reach the alert service. Try again.");
  const reg = await registration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another key can't receive our alerts; replace it.
  const old = sub?.options.applicationServerKey;
  if (sub && old && btoaBytes(new Uint8Array(old)) !== btoaBytes(keyBytes(publicKey))) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const json = sub.toJSON();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh ?? "",
    p_auth: json.keys?.auth ?? "",
    p_device: deviceLabel(),
  });
  if (error) throw new Error(error.message);
}

function btoaBytes(b: Uint8Array) {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}

// Removes this device's alerts for the person who is signing out, so a shared
// phone doesn't keep getting their notifications.
export async function forgetPushOnSignOut() {
  try {
    if (!pushSupported()) return;
    await disablePush();
  } catch {
    // signing out must never fail because of this
  }
}

export async function sendTestPush() {
  const { data } = await supabase.auth.getSession();
  const res = await fetch(PUSH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: JSON.stringify({ test: true }),
  });
  const body = (await res.json()) as { sent?: number; error?: string };
  if (!res.ok) throw new Error(body.error ?? "Couldn't send a test alert.");
  return body.sent ?? 0;
}

export function usePush() {
  const [state, setState] = useState<PushState>("loading");
  const [error, setError] = useState("");
  const refresh = () => currentPushState().then(setState, () => setState("unsupported"));
  useEffect(() => {
    refresh();
  }, []);
  async function run(fn: () => Promise<unknown>) {
    setError("");
    setState("loading");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    await refresh();
  }
  return {
    state,
    error,
    enable: () => run(async () => {
      await enablePush();
      await sendTestPush().catch(() => 0);
    }),
    disable: () => run(disablePush),
  };
}
