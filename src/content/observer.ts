import { validateBridge } from "../shared/adapter";
const marker = "__routebackObserverV1";
const isolated = globalThis as typeof globalThis & { [marker]?: boolean };
if (!isolated[marker]) {
  isolated[marker] = true;
  let monitoring = true;
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (
      sender.id === chrome.runtime.id &&
      message?.type === "routeback-disable"
    ) {
      monitoring = false;
      window.postMessage({ channel: "routeback-disable-v1" }, location.origin);
    }
  });
  window.addEventListener("message", (event) => {
    if (
      !monitoring ||
      event.source !== window ||
      event.origin !== "https://chatgpt.com" ||
      event.data?.channel !== "routeback-v1"
    ) return;
    if (event.data.notice === "Visible context is too large to capture safely. Copy the conversation into Chat manually.") {
      document.getElementById('routeback-capture-notice')?.remove();
      const notice = document.createElement('div');
      notice.id = 'routeback-capture-notice';
      notice.setAttribute('role', 'status');
      notice.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;max-width:340px;padding:16px;border-radius:12px;background:#f7ece2;color:#68462f;font:13px/1.6 system-ui;box-shadow:0 4px 24px #0002';
      notice.textContent = 'RouteBackAI: ' + event.data.notice;
      const dismiss = document.createElement('button');
      dismiss.textContent = 'Dismiss';
      dismiss.style.cssText = 'display:block;margin-top:8px;border:0;background:transparent;color:inherit;text-decoration:underline;cursor:pointer';
      dismiss.onclick = () => notice.remove();
      notice.append(dismiss); document.documentElement.append(notice);
      setTimeout(() => notice.remove(), 15_000);
      return;
    }
    if (!validateBridge(event.data.event)) return;
    void chrome.runtime
      .sendMessage({ type: "bridge", event: event.data.event })
      .catch(() => undefined);
  });
}
