import { RecoveryEngine } from "./engine";
import { isGenerationURL, validateBridge } from "../shared/adapter";
import {
  isRecoverableStatus,
  type Attempt,
  type PanelRequest,
  type PanelResponse,
} from "../shared/types";

const KEY = "routeback.pending.v1";
const OBS = "routeback.requests.v1";
interface Observation {
  requestId: string;
  tabId: number;
  documentId?: string;
  url: string;
  at: number;
  status?: number;
  error?: string;
}
let engine: RecoveryEngine;
let observations: Observation[] = [];
const ready = (async () => {
  await chrome.storage.session.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  const stored = await chrome.storage.session.get([KEY, OBS]);
  engine = new RecoveryEngine(
    Array.isArray(stored[KEY]) ? (stored[KEY] as Attempt[]) : [],
  );
  observations = Array.isArray(stored[OBS])
    ? (stored[OBS] as Observation[])
    : [];
})();
let queue: Promise<unknown> = ready;
function transaction<T>(operation: () => Promise<T> | T): Promise<T> {
  const next = queue.then(operation);
  queue = next.catch(() => undefined);
  return next;
}
async function persist() {
  engine.sweep();
  observations = observations
    .filter((o) => o.at > Date.now() - 300_000)
    .slice(-100);
  // Failures past the retry grace get one in-page prompt on their ChatGPT tab.
  const announce = engine.attempts.filter(
    (a) =>
      a.error &&
      !a.notified &&
      (a.state === "failed" || a.state === "confirmation"),
  );
  for (const a of announce) a.notified = true;
  await chrome.storage.session.set({
    [KEY]: engine.attempts,
    [OBS]: observations,
  });
  await updateBadges();
  await Promise.all(
    announce.map((a) =>
      chrome.tabs
        .sendMessage(
          a.tabId,
          {
            type: "routeback-failed",
            id: a.id,
            error: a.error,
            // Shown so the click is an informed confirmation of this exact prompt.
            query: a.query.length > 140 ? a.query.slice(0, 140) + "…" : a.query,
          },
          { documentId: a.documentId },
        )
        .catch(() => undefined),
    ),
  );
  const due = engine.attempts
    .filter((a) => a.state === "waiting")
    .map((a) => a.dueAt!);
  if (due.length)
    await chrome.alarms.create("routeback-retry", {
      when: Math.max(Date.now() + 50, Math.min(...due)),
    });
}
// Tabs currently showing the failure badge. Unknown after a service worker restart.
let badged: Set<number> | undefined;
async function updateBadges() {
  const next = new Set(
    engine.attempts.filter((a) => a.error).map((a) => a.tabId),
  );
  let targets: number[];
  if (!badged) {
    await chrome.action.setBadgeBackgroundColor({ color: "#b85c30" });
    targets = (await chrome.tabs.query({}))
      .map((t) => t.id)
      .filter((id): id is number => id !== undefined);
  } else {
    // Only touch tabs whose badge state changed; skips tabs.query on every persist.
    targets = [...new Set([...badged, ...next])].filter(
      (id) => badged!.has(id) !== next.has(id),
    );
  }
  badged = next;
  await Promise.all(
    targets.map((tabId) =>
      chrome.action
        .setBadgeText({ tabId, text: next.has(tabId) ? "!" : "" })
        .catch(() => undefined),
    ),
  );
}
async function stopCapture() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((t) => t.id !== undefined)
      .map((t) =>
        chrome.tabs
          .sendMessage(t.id!, { type: "routeback-disable" })
          .catch(() => undefined),
      ),
  );
}
// Prompts are answered automatically unless the user opted into confirming each one.
async function autoRecover() {
  return (
    (await chrome.storage.local.get("adapterVerified")).adapterVerified !==
    false
  );
}
async function enabled() {
  return chrome.permissions.contains({ origins: ["https://chatgpt.com/*"] });
}
async function register() {
  const ids = ["routeback-observer", "routeback-bridge"];
  const current = await chrome.scripting.getRegisteredContentScripts();
  const registered = current.filter((x) => ids.includes(x.id)).map((x) => x.id);
  if (registered.length)
    await chrome.scripting.unregisterContentScripts({ ids: registered });
  if (!(await enabled())) return;
  await chrome.scripting.registerContentScripts([
    {
      id: ids[0],
      matches: ["https://chatgpt.com/*"],
      js: ["assets/observer.js"],
      runAt: "document_start",
      world: "ISOLATED",
    },
    {
      id: ids[1],
      matches: ["https://chatgpt.com/*"],
      js: ["assets/bridge.js"],
      runAt: "document_start",
      world: "MAIN",
    },
  ]);
}
async function configure() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await chrome.alarms.create("routeback-cleanup", { periodInMinutes: 0.5 });
  await register();
}
chrome.runtime.onInstalled.addListener(() => {
  void configure().catch(console.error);
});
chrome.runtime.onStartup.addListener(() => {
  void configure().catch(console.error);
});
chrome.permissions.onAdded.addListener(() => {
  void register().catch(console.error);
});
chrome.permissions.onRemoved.addListener(() => {
  void transaction(async () => {
    if (!(await enabled())) {
      await stopCapture();
      engine.attempts = [];
      observations = [];
      await persist();
      await register();
    }
  });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith("routeback-")) void transaction(persist);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void transaction(async () => {
    engine.removeTab(tabId);
    observations = observations.filter((o) => o.tabId !== tabId);
    await persist();
  });
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading")
    void transaction(async () => {
      engine.removeTab(tabId);
      observations = observations.filter((o) => o.tabId !== tabId);
      await persist();
    });
});

function correlate(a: Attempt) {
  const candidates = observations.filter(
    (o) =>
      o.tabId === a.tabId &&
      (!o.documentId || o.documentId === a.documentId) &&
      o.url === a.url &&
      Math.abs(o.at - a.createdAt) < 2500,
  );
  if (
    candidates.length === 1 &&
    !engine.attempts.some(
      (other) =>
        other.id !== a.id && other.requestId === candidates[0].requestId,
    )
  )
    a.requestId = candidates[0].requestId;
  return a.requestId
    ? observations.find(
        (o) => o.requestId === a.requestId && o.tabId === a.tabId,
      )
    : undefined;
}
function applyObservation(o: Observation) {
  const candidates = engine.attempts.filter(
    (a) =>
      a.tabId === o.tabId &&
      a.url === o.url &&
      (!o.documentId || a.documentId === o.documentId) &&
      Math.abs(o.at - a.createdAt) < 2500,
  );
  for (const a of candidates) {
    if (candidates.length !== 1) {
      a.state = "confirmation";
      continue;
    }
    a.requestId = o.requestId;
    if (o.status !== undefined || o.error !== undefined)
      engine.outcome(a.id, a.tabId, a.documentId, o.status, o.error);
  }
}
const filter = {
  urls: ["https://chatgpt.com/*"],
  types: ["xmlhttprequest"] as chrome.webRequest.ResourceType[],
};
chrome.webRequest.onBeforeRequest.addListener((details) => {
  if (
    !isGenerationURL(details.url) ||
    details.method !== "POST" ||
    details.tabId < 0 ||
    details.frameId !== 0
  )
    return undefined;
  void transaction(async () => {
    const o: Observation = {
      requestId: details.requestId,
      tabId: details.tabId,
      documentId: details.documentId,
      url: details.url,
      at: details.timeStamp,
    };
    observations.push(o);
    applyObservation(o);
    await persist();
  });
  return undefined;
}, filter);
chrome.webRequest.onCompleted.addListener((details) => {
  if (!isGenerationURL(details.url)) return;
  void transaction(async () => {
    const o = observations.find(
      (o) => o.requestId === details.requestId && o.tabId === details.tabId,
    );
    if (o) {
      o.status = details.statusCode;
      applyObservation(o);
      await persist();
    }
  });
}, filter);
chrome.webRequest.onErrorOccurred.addListener((details) => {
  if (!isGenerationURL(details.url)) return;
  void transaction(async () => {
    const o = observations.find(
      (o) => o.requestId === details.requestId && o.tabId === details.tabId,
    );
    if (o) {
      o.error = /ERR_ABORTED|ERR_BLOCKED_BY_CLIENT/.test(details.error)
        ? "cancelled"
        : "network";
      applyObservation(o);
      await persist();
    }
  });
}, filter);

const owners = new Set<string>();
chrome.runtime.onConnect.addListener((port) => {
  if (
    !port.name.startsWith("panel:") ||
    port.sender?.url !== chrome.runtime.getURL("sidepanel.html")
  )
    return;
  const owner = port.name.slice(6);
  owners.add(owner);
  port.onDisconnect.addListener(() => {
    owners.delete(owner);
    void transaction(async () => {
      engine.releaseOwner(owner);
      await persist();
    });
  });
});
chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;
    const m = message as Record<string, unknown>;
    if (m.type === "open-panel") {
      // Sent from the in-page recovery prompt. Open synchronously so the click's user gesture still applies.
      if (
        sender.tab?.windowId === undefined ||
        !sender.url ||
        new URL(sender.url).origin !== "https://chatgpt.com"
      )
        return false;
      const opened = chrome.sidePanel.open({ windowId: sender.tab.windowId });
      const tabId = sender.tab.id;
      // The user saw this prompt in the notice and asked for an answer: that confirms it.
      const confirmed = transaction(async () => {
        const a = engine.attempts.find(
          (a) => a.id === m.id && a.tabId === tabId,
        );
        if (a?.error && a.state === "confirmation") {
          a.state = "failed";
          await persist();
        }
      });
      Promise.all([opened, confirmed]).then(
        () => sendResponse({ ok: true }),
        (e) => sendResponse({ ok: false, error: String(e) }),
      );
      return true;
    }
    if (m.type === "bridge") {
      if (
        sender.tab?.id === undefined ||
        sender.frameId !== 0 ||
        !sender.documentId ||
        !sender.url ||
        new URL(sender.url).origin !== "https://chatgpt.com" ||
        !validateBridge(m.event)
      )
        return false;
      void transaction(async () => {
        if (!(await enabled())) return;
        const event = m.event as import("../shared/types").BridgeEvent;
        if (event.kind === "capture") {
          const verified = await autoRecover();
          engine.capture(
            event.capture,
            sender.tab!.id!,
            sender.documentId!,
            verified,
          );
          const a = engine.attempts.find((a) => a.id === event.capture.id);
          if (a) {
            const o = correlate(a);
            if (o) applyObservation(o);
          }
        } else {
          const a = engine.attempts.find(
            (a) =>
              a.id === event.id &&
              a.tabId === sender.tab!.id &&
              a.documentId === sender.documentId,
          );
          if (a) {
            const o = correlate(a);
            if (o && (o.status !== undefined || o.error !== undefined))
              applyObservation(o);
            else if (o) {
              /* Wait for the browser-observed outcome before trusting the page signal. */
            } else if (
              event.error === "cancelled" ||
              (event.status && event.status >= 200 && event.status < 300)
            )
              engine.remove(a.id);
            else if (
              event.error === "network" ||
              isRecoverableStatus(event.status)
            ) {
              a.state = "confirmation";
              engine.outcome(
                a.id,
                a.tabId,
                a.documentId,
                event.status,
                event.error,
              );
            } else engine.remove(a.id);
          }
        }
        await persist();
        sendResponse({ ok: true });
      }).catch(() => sendResponse({ ok: false }));
      return true;
    }
    if (
      sender.id !== chrome.runtime.id ||
      sender.url !== chrome.runtime.getURL("sidepanel.html")
    )
      return false;
    void transaction(async (): Promise<PanelResponse> => {
      const swept = engine.sweep();
      if (import.meta.env.MODE === "demo" && m.type === "demo-failure") {
        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        const id = crypto.randomUUID();
        engine.capture(
          {
            id,
            query: "Why is the sky blue?",
            snapshot: { turns: [], incomplete: true },
            url: "https://chatgpt.com/backend-api/conversation",
            ambiguous: false,
          },
          tabs[0]?.id || 1,
          "demo-document",
          true,
        );
        engine.outcome(id, tabs[0]?.id || 1, "demo-document", 503);
        const a = engine.attempts.find((a) => a.id === id)!;
        a.dueAt = Date.now();
        await persist();
        return { ok: true };
      }
      const req = message as PanelRequest;
      switch (req.type) {
        case "status":
          return {
            ok: true,
            enabled: await enabled(),
            adapterEnabled: await autoRecover(),
          };
        case "enable":
          await register();
          return { ok: true, enabled: await enabled() };
        case "disable":
          await stopCapture();
          await chrome.permissions.remove({
            origins: ["https://chatgpt.com/*"],
          });
          engine.attempts = [];
          observations = [];
          await register();
          break;
        case "adapter":
          await chrome.storage.local.set({
            adapterVerified: req.enabled === true,
          });
          return { ok: true };
        case "attempts":
          // Read path: only write storage/badges when the sweep changed state.
          if (swept) await persist();
          return { ok: true, attempts: engine.attempts };
        case "claim": {
          if (!owners.has(req.owner))
            return {
              ok: false,
              error: "Panel connection expired. Reopen the panel.",
            };
          const attempt = engine.claim(
            req.id,
            req.owner,
            req.confirmed === true,
          );
          await persist();
          return {
            ok: !!attempt,
            attempt,
            error: attempt
              ? undefined
              : "Prompt expired, is not ready, or is already being processed.",
          };
        }
        case "release":
          engine.release(req.id, req.owner);
          break;
        case "complete":
          engine.complete(req.id, req.owner);
          break;
        case "dismiss":
          engine.remove(req.id);
          break;
        default:
          return { ok: false, error: "Unknown request" };
      }
      await persist();
      return { ok: true };
    }).then(sendResponse, () =>
      sendResponse({
        ok: false,
        error: "Recovery storage could not be updated.",
      }),
    );
    return true;
  },
);
