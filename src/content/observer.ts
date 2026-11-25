import { validateBridge } from "../shared/adapter";
const marker = "__routebackObserverV1";
const isolated = globalThis as typeof globalThis & { [marker]?: boolean };
const TOO_LARGE =
  "Visible context is too large to capture safely. Copy the conversation into Chat manually.";
// Small fixed-position notice on the ChatGPT page, optionally with one action button.
function showNotice(
  text: string,
  action?: { label: string; run: (notice: HTMLElement) => void },
) {
  document.getElementById("routeback-capture-notice")?.remove();
  const notice = document.createElement("div");
  notice.id = "routeback-capture-notice";
  notice.setAttribute("role", "status");
  notice.style.cssText =
    "position:fixed;bottom:24px;right:24px;z-index:2147483647;max-width:340px;padding:16px;border-radius:12px;background:#f7ece2;color:#68462f;font:13px/1.6 system-ui;box-shadow:0 4px 24px #0002";
  const message = document.createElement("p");
  message.style.margin = "0";
  message.textContent = "RouteBackAI: " + text;
  notice.append(message);
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:12px;margin-top:8px";
  const button = (label: string, primary = false) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = primary
      ? "border:0;border-radius:8px;padding:6px 12px;background:#b85c30;color:#fff;font:inherit;cursor:pointer"
      : "border:0;background:transparent;color:inherit;text-decoration:underline;font:inherit;cursor:pointer";
    row.append(b);
    return b;
  };
  if (action) button(action.label, true).onclick = () => action.run(notice);
  button("Dismiss").onclick = () => notice.remove();
  notice.append(row);
  document.documentElement.append(notice);
  setTimeout(() => notice.remove(), 30_000);
}
if (!isolated[marker]) {
  isolated[marker] = true;
  let monitoring = true;
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.type === "routeback-disable") {
      monitoring = false;
      window.postMessage({ channel: "routeback-disable-v1" }, location.origin);
    }
    if (monitoring && message?.type === "routeback-failed")
      showNotice(
        `${typeof message.error === "string" ? message.error : "ChatGPT failed"}. Saved prompt: “${typeof message.query === "string" ? message.query : ""}”`,
        {
          label: "Answer with Gemini Nano",
          // The click is the user gesture Chrome requires to open the side panel.
          run: (notice) => {
            void chrome.runtime
              .sendMessage({ type: "open-panel", id: message.id })
              .then((res) => {
                if (res?.ok) notice.remove();
                else throw new Error();
              })
              .catch(() =>
                showNotice(
                  "Click the RouteBackAI toolbar icon to see the answer.",
                ),
              );
          },
        },
      );
  });
  window.addEventListener("message", (event) => {
    if (
      !monitoring ||
      event.source !== window ||
      event.origin !== "https://chatgpt.com" ||
      event.data?.channel !== "routeback-v1"
    )
      return;
    if (event.data.notice === TOO_LARGE) {
      showNotice(TOO_LARGE);
      return;
    }
    if (!validateBridge(event.data.event)) return;
    void chrome.runtime
      .sendMessage({ type: "bridge", event: event.data.event })
      .catch(() => undefined);
  });
}
