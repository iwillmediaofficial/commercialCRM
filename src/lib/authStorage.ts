// Where the sign-in session is kept, so "Remember me" can work.
// Remembered: localStorage, which survives closing the browser (the old behaviour).
// Not remembered: sessionStorage, which the browser clears when it closes.
// sessionStorage is per tab, so a new tab asks the open tabs for the session
// before deciding the person is signed out.

const REMEMBER_KEY = "auth-remember";
const EMAIL_KEY = "auth-remember-email";
const CHANNEL = "auth-session-share";

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** True unless the person last signed in with "Remember me" unticked. */
export function getRememberMe(): boolean {
  return safe(() => localStorage.getItem(REMEMBER_KEY) !== "0", true);
}

/** Call just before signing in. Moves any stored session to the right place. */
export function setRememberMe(remember: boolean) {
  safe(() => {
    localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
    const [from, to] = remember ? [sessionStorage, localStorage] : [localStorage, sessionStorage];
    for (const key of Object.keys(from)) {
      if (!key.startsWith("sb-")) continue;
      to.setItem(key, from.getItem(key) ?? "");
      from.removeItem(key);
    }
  }, undefined);
}

export function getRememberedEmail(): string {
  return safe(() => localStorage.getItem(EMAIL_KEY) ?? "", "");
}

export function setRememberedEmail(email: string | null) {
  safe(() => (email ? localStorage.setItem(EMAIL_KEY, email) : localStorage.removeItem(EMAIL_KEY)), undefined);
}

const channel: BroadcastChannel | null = safe(
  () => (typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL)),
  null,
);

type Msg = { type: "ask"; id: string; key: string } | { type: "answer"; id: string; value: string | null };

// Answer other tabs that are opening without a session of their own.
channel?.addEventListener("message", (e: MessageEvent<Msg>) => {
  const msg = e.data;
  if (msg?.type !== "ask" || getRememberMe()) return;
  const value = safe(() => sessionStorage.getItem(msg.key), null);
  if (value) channel.postMessage({ type: "answer", id: msg.id, value } satisfies Msg);
});

function askOtherTabs(key: string): Promise<string | null> {
  if (!channel) return Promise.resolve(null);
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    const done = (value: string | null) => {
      channel.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(value);
    };
    const onMessage = (e: MessageEvent<Msg>) => {
      if (e.data?.type === "answer" && e.data.id === id) done(e.data.value);
    };
    const timer = setTimeout(() => done(null), 300);
    channel.addEventListener("message", onMessage);
    channel.postMessage({ type: "ask", id, key } satisfies Msg);
  });
}

export const authStorage = {
  async getItem(key: string): Promise<string | null> {
    if (getRememberMe()) return safe(() => localStorage.getItem(key), null);
    const own = safe(() => sessionStorage.getItem(key), null);
    if (own) return own;
    const shared = await askOtherTabs(key);
    if (shared) safe(() => sessionStorage.setItem(key, shared), undefined);
    return shared;
  },
  setItem(key: string, value: string) {
    safe(() => (getRememberMe() ? localStorage : sessionStorage).setItem(key, value), undefined);
  },
  removeItem(key: string) {
    safe(() => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    }, undefined);
  },
};
