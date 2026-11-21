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
