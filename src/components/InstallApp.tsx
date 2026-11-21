import { useState } from "react";
import { Icon } from "./icons";
import { Modal } from "./ui";
import { isIos, useInstall, usePush } from "../lib/pwa";

// Steps for iPhone / iPad, where Safari has no install button of its own.
export function IosInstallSteps({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Install on iPhone or iPad" onClose={onClose}>
      <ol className="space-y-3 text-sm text-slate-700">
        <li className="flex gap-3">
          <Step n={1} />
          <span>
            Open this site in <b>Safari</b> (other browsers on iPhone can't install apps).
          </span>
        </li>
        <li className="flex gap-3">
          <Step n={2} />
          <span>
            Tap the <b>Share</b> button <Icon name="share" className="inline h-4 w-4 align-[-2px] text-brand-600" /> at the bottom of the screen.
          </span>
        </li>
        <li className="flex gap-3">
          <Step n={3} />
          <span>
            Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.
          </span>
        </li>
        <li className="flex gap-3">
          <Step n={4} />
          <span>
            Open the CRM from its new icon on your home screen. To get alerts for new leads, open your account menu there and turn on{" "}
            <b>Phone alerts</b>.
          </span>
        </li>
      </ol>
      <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Phone alerts on iPhone need iOS 16.4 or newer and only work in the installed app.</p>
    </Modal>
  );
}

function Step({ n }: { n: number }) {
  return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">{n}</span>;
}

const itemClass = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-slate-700 hover:bg-slate-50 disabled:opacity-60";

// "Install app" row for the account menu. Hidden once installed or when the browser can't install.
export function InstallMenuItem({ onDone }: { onDone?: () => void }) {
  const install = useInstall();
  const [ios, setIos] = useState(false);
  if (install.kind === "installed" || install.kind === "unavailable") return null;
  return (
    <>
      <button
        className={itemClass}
        onClick={async () => {
          if (install.kind === "prompt") {
            await install.install();
            onDone?.();
          } else setIos(true);
        }}
      >
        <Icon name="download" className="h-4 w-4 text-slate-400" />
        Install app
      </button>
      {ios && <IosInstallSteps onClose={() => { setIos(false); onDone?.(); }} />}
    </>
  );
}

// "Phone alerts" switch for the account menu.
export function PhoneAlertsMenuItem() {
  const push = usePush();
  const [ios, setIos] = useState(false);
  if (push.state === "unsupported") return null;
  const on = push.state === "on";
  const label =
    push.state === "needs-install" ? "Phone alerts (install first)" :
    push.state === "blocked" ? "Phone alerts blocked" :
    "Phone alerts";
  return (
    <>
      <button
        className={itemClass}
        disabled={push.state === "loading"}
        onClick={() => {
          if (push.state === "needs-install") setIos(true);
          else if (push.state === "blocked") return;
          else if (on) push.disable();
          else push.enable();
        }}
      >
        <Icon name="bell" className="h-4 w-4 text-slate-400" />
        <span className="flex-1">{label}</span>
        {(push.state === "on" || push.state === "off" || push.state === "loading") && <Toggle on={on} />}
      </button>
      {on && (
        <button className={itemClass} onClick={push.test}>
          <span className="h-4 w-4" />
          <span className="text-brand-700">Send a test alert</span>
        </button>
      )}
      {push.testNote && <p className="px-3 pb-2 text-xs text-slate-500">{push.testNote}</p>}
      {push.state === "blocked" && <p className="px-3 pb-2 text-xs text-slate-500">Allow notifications for this site in the browser's settings, then try again.</p>}
      {push.error && <p className="px-3 pb-2 text-xs text-red-600">{push.error}</p>}
      {ios && <IosInstallSteps onClose={() => setIos(false)} />}
    </>
  );
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition ${on ? "bg-brand-600" : "bg-slate-300"}`} aria-hidden>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </span>
  );
}

// Card at the bottom of the notification list, offering alerts on this device.
export function PhoneAlertsOffer() {
  const push = usePush();
  const [ios, setIos] = useState(false);
  if (push.state !== "off" && push.state !== "needs-install" && push.state !== "blocked") return null;
  return (
    <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-600">
      {push.state === "blocked" ? (
        <>Alerts are blocked for this site. Allow notifications in the browser's site settings to get them on this device.</>
      ) : (
        <div className="flex items-center gap-3">
          <span className="flex-1">Get new leads and follow-up reminders as alerts on this device.</span>
          <button
            className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 font-semibold text-white hover:bg-brand-700"
            onClick={() => (push.state === "needs-install" ? setIos(true) : push.enable())}
          >
            Turn on
          </button>
        </div>
      )}
      {push.error && <p className="mt-1 text-red-600">{push.error}</p>}
      {ios && <IosInstallSteps onClose={() => setIos(false)} />}
    </div>
  );
}

const BANNER_KEY = "install-banner-dismissed";

function bannerDismissed() {
  try {
    return localStorage.getItem(BANNER_KEY) === "1";
  } catch {
    return false;
  }
}

// One-time strip on phones and tablets suggesting the app. Closing it hides it for good on this device.
export function InstallBanner() {
  const install = useInstall();
  const [hidden, setHidden] = useState(bannerDismissed);
  const [ios, setIos] = useState(false);
  const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  if (hidden || !touch || (install.kind !== "prompt" && install.kind !== "ios")) return null;
  if (install.kind === "ios" && !isIos()) return null;
  function close() {
    try {
      localStorage.setItem(BANNER_KEY, "1");
    } catch {
      // private mode: just hide for now
    }
    setHidden(true);
  }
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <img src="/icons/icon-192.png" alt="" className="h-10 w-10 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-semibold text-slate-900">Install the app</div>
        <div className="text-xs text-slate-500">Open the CRM from your home screen and get alerts for new leads.</div>
      </div>
      <button
        className="shrink-0 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        onClick={async () => {
          if (install.kind === "prompt") {
            if (await install.install()) close();
          } else setIos(true);
        }}
      >
        Install
      </button>
      <button className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100" aria-label="Not now" onClick={close}>
        <Icon name="close" className="h-4 w-4" />
      </button>
      {ios && <IosInstallSteps onClose={() => setIos(false)} />}
    </div>
  );
}
