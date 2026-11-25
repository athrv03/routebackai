import { defineManifest } from "@crxjs/vite-plugin";
export default defineManifest({
  manifest_version: 3,
  name: "RouteBackAI",
  version: "0.2.0",
  minimum_chrome_version: "139",
  description:
    "Local-first Gemini chat and transparent Firebase hybrid recovery for failed ChatGPT requests.",
  permissions: ["sidePanel", "storage", "scripting", "webRequest", "alarms", "unlimitedStorage"],
  optional_host_permissions: ["https://chatgpt.com/*"],
  background: { service_worker: "src/background/index.ts", type: "module" },
  action: { default_title: "Open RouteBackAI" },
  side_panel: { default_path: "sidepanel.html" },
  icons: { "128": "icons/icon.png" },
  content_security_policy: {
    extension_pages:
      "script-src 'self'; object-src 'self'; connect-src 'self' https://firebasevertexai.googleapis.com https://content-firebaseappcheck.googleapis.com https://firebaseinstallations.googleapis.com",
  },
});
