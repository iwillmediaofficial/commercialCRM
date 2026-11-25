import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installErrorReporting } from "./lib/errors";
import { setupPwa } from "./lib/pwa";
import "./index.css";

installErrorReporting();
setupPwa();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
hideBootScreenWhenReady();

// Keep the first-load screen up while the app is still showing loaders (auth,
// lazy page, first data), so opening the app goes logo -> page with no blank
// or flashing loader in between. Gives up after 10 s.
function hideBootScreenWhenReady() {
  const boot = document.getElementById("boot");
  if (!boot) return;
  const root = document.getElementById("root")!;
  const started = Date.now();
  let calm: ReturnType<typeof setTimeout> | undefined;
  const done = () => {
    obs.disconnect();
    clearTimeout(calm);
    boot.classList.add("gone");
    setTimeout(() => boot.remove(), 300);
  };
  const check = () => {
    clearTimeout(calm);
    if (Date.now() - started > 10000) return done();
    const ready = root.childElementCount > 0 && !root.querySelector("[data-loading]");
    if (ready) calm = setTimeout(done, 120);
  };
  const obs = new MutationObserver(check);
  obs.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-loading"] });
  setTimeout(() => { if (boot.isConnected) done(); }, 10000);
  check();
}
