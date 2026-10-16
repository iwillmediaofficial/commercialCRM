import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// App version reported with crash logs: VITE_APP_VERSION if set, else the Cloudflare Pages commit.
const appVersion = process.env.VITE_APP_VERSION || process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: appVersion ? { "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion) } : {},
});
