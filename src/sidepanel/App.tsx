import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Cloud,
  Copy,
  Cpu,
  Download,
  History,
  Leaf,
  LoaderCircle,
  MessageSquare,
  Plus,
  RotateCcw,
  Settings,
  ShieldCheck,
  Square,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  FirebaseProvider,
  configured,
  privateBuild,
  type Provider,
} from "../ai/provider";
import {
  completeTurns,
  exceedsLocalWords,
  MAX_LOCAL_WORDS,
  route,
  serialize,
} from "../shared/routing";
import type {
  Attempt,
  Chat,
  ChatMessage,
  Classification,
  Decision,
  Mode,
  Source,
  Turn,
} from "../shared/types";
import { loadChats, newChat, saveChats } from "../storage/chats";
import { recoverNanoFirst } from "../ai/recovery";
import { request } from "./api";
const demo = import.meta.env.MODE === "demo";
const createProvider = async (): Promise<Provider> =>
  demo
    ? new (await import("../ai/demo-provider")).DemoProvider()
    : new FirebaseProvider();
const owner = crypto.randomUUID();
const sourceLabel = (source?: Source) =>
  source === "ON_DEVICE"
    ? "Gemini Nano · on-device"
    : source === "IN_CLOUD"
      ? "Gemini · Firebase cloud"
      : "Source pending";
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      skipHtml
      components={{
        img: () => null,
        a: ({ href, children }) =>
          href && /^(https?:|mailto:)/i.test(href) ? (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ) : (
            <span>{children}</span>
          ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="icon-button"
      title="Copy"
      aria-label="Copy"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => setCopied(false),
        );
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}
// Owns its own ticker so the countdown does not re-render the whole panel every second.
function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{Math.max(0, Math.ceil((until - now) / 1000))}s</>;
}
interface RecoveryResult {
  id: string;
  tabId: number;
  query: string;
  text: string;
  source?: Source;
  reason: string;
  error: string;
  interrupted?: boolean;
  /** Saved conversation holding this recovered answer. */
  chatId?: string;
}
export function App() {
  const [provider, setProvider] = useState<Provider>();
  const [view, setView] = useState<"chat" | "recovery">("chat");
  const [mode, setMode] = useState<Mode>("auto");
  const [chats, setChats] = useState<Chat[]>([]);
  const chatsRef = useRef<Chat[]>([]);
  const [currentId, setCurrentId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const abort = useRef<AbortController | undefined>(undefined);
  const activeRecovery = useRef<
    { id: string; tabId: number; expiresAt: number } | undefined
  >(undefined);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [decision, setDecision] = useState<Decision>();
  const [availability, setAvailability] = useState("checking");
  const [progress, setProgress] = useState<number>();
  const [settings, setSettings] = useState(false);
  const [history, setHistory] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  // True = answer failed ChatGPT prompts automatically (default); false = confirm each one.
  const [adapterEnabled, setAdapterEnabled] = useState(true);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [results, setResults] = useState<RecoveryResult[]>([]);
  const resultsRef = useRef<RecoveryResult[]>([]);
  const [held, setHeld] = useState<Set<string>>(new Set());
  const seen = useRef(new Set<string>());
  const mounted = useRef(true);
  // Bumped by a one-shot timer at the next attempt deadline so expired items re-render.
  const [, setTick] = useState(0);
  const end = useRef<HTMLDivElement>(null);
  const current = chats.find((c) => c.id === currentId);
  // Jump to the Recovery tab whenever a failure appears that this panel hasn't shown yet.
  const announced = useRef(new Set<string>());
  const showAttempts = (next: Attempt[]) => {
    setAttempts(next);
    const fresh = next.filter((a) => a.error && !announced.current.has(a.id));
    fresh.forEach((a) => announced.current.add(a.id));
    if (fresh.length) setView("recovery");
  };
  const draft = drafts[currentId] || "";

  useEffect(() => {
    mounted.current = true;
    const port = chrome.runtime.connect({ name: `panel:${owner}` });
    void createProvider().then((p) => {
      if (mounted.current) {
        setProvider(p);
        void p
          .availability()
          .then(setAvailability, () => setAvailability("unavailable"));
      }
    });
    void Promise.all([
      loadChats(),
      chrome.storage.local.get(["onboarded", "mode"]),
      request({ type: "status" }),
    ]).then(
      ([saved, prefs, status]) => {
        if (!mounted.current) return;
        const initial = saved.length ? saved : [newChat()];
        chatsRef.current = initial;
        persisted.current = saved;
        setChats(initial);
        setCurrentId(initial[0].id);
        setLoaded(true);
        setOnboarded(prefs.onboarded === true);
        setMode(prefs.mode === "local" ? "local" : "auto");
        setEnabled(!!status.enabled);
        setAdapterEnabled(!!status.adapterEnabled);
      },
      (e) => {
        setError(errorText(e));
        setStorageFailed(true);
        setLoaded(true);
      },
    );
    const poll = () => {
      void request({ type: "attempts" }).then(
        (res) => {
          if (mounted.current) showAttempts(res.attempts || []);
        },
        (e) => {
          if (mounted.current) setError(errorText(e));
        },
      );
    };
    // Initial fetch only; later updates arrive through storage.onChanged and deadline refreshes.
    poll();
    const onStorage = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "session" && changes["routeback.pending.v1"]) {
        const next = (changes["routeback.pending.v1"].newValue ||
          []) as Attempt[];
        showAttempts(next);
        if (
          activeRecovery.current &&
          !next.some((a) => a.id === activeRecovery.current!.id)
        )
          abort.current?.abort();
      }
    };
    const onClosed = (tabId: number) => {
      if (activeRecovery.current?.tabId === tabId) abort.current?.abort();
      resultsRef.current = resultsRef.current.filter((r) => r.tabId !== tabId);
      setResults(resultsRef.current);
    };
    const onRevoked = (permissions: chrome.permissions.Permissions) => {
      if (permissions.origins?.includes("https://chatgpt.com/*")) {
        if (activeRecovery.current) abort.current?.abort();
        setEnabled(false);
        resultsRef.current = [];
        setResults([]);
        setAttempts([]);
      }
    };
    chrome.permissions.onRemoved.addListener(onRevoked);
    chrome.storage.onChanged.addListener(onStorage);
    chrome.tabs.onRemoved.addListener(onClosed);
    const unload = () => {
      mounted.current = false;
      abort.current?.abort();
      port.disconnect();
    };
    window.addEventListener("pagehide", unload);
    return () => {
      unload();
      window.removeEventListener("pagehide", unload);
      chrome.storage.onChanged.removeListener(onStorage);
      chrome.tabs.onRemoved.removeListener(onClosed);
      chrome.permissions.onRemoved.removeListener(onRevoked);
    };
  }, []);
  useEffect(() => {
    if (view === "chat" && !current?.messages.length) {
      end.current?.parentElement?.scrollTo({ top: 0 });
      return;
    }
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chats, results, view, currentId]);
  // Serialize storage writes so streamed completion cannot overwrite a newer user action.
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const persisted = useRef<Chat[] | undefined>(undefined);
  const store = useCallback((next: Chat[]) => {
    chatsRef.current = next;
    if (mounted.current) setChats(next);
    const write = writes.current
      .catch(() => undefined)
      .then(async () => {
        // Diff against the last successful write so only changed chats are rewritten.
        await saveChats(next, persisted.current);
        persisted.current = next;
      });
    writes.current = write;
    return write.catch((e) => {
      if (mounted.current) {
        setStorageFailed(true);
        setError(
          `Chats could not be saved: ${errorText(e)}. Your visible messages are still in this panel.`,
        );
      }
      throw e;
    });
  }, []);
  const updateMessage = (
    chatId: string,
    messageId: string,
    patch: Partial<ChatMessage>,
    persist = false,
  ) => {
    const next = chatsRef.current.map((c) =>
      c.id !== chatId
        ? c
        : {
            ...c,
            updatedAt: Date.now(),
            messages: c.messages.map((m) =>
              m.id === messageId ? { ...m, ...patch } : m,
            ),
          },
    );
    chatsRef.current = next;
    if (mounted.current) setChats(next);
    return persist ? store(next) : Promise.resolve();
  };
  const acquire = () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    abort.current = controller;
    return controller;
  };
  const finish = () => {
    busyRef.current = false;
    if (mounted.current) setBusy(false);
  };
  const decide = async (
    query: string,
    turns: Turn[],
    controller: AbortController,
  ) => {
    if (!provider) throw new Error("Model provider is loading.");
    const text = serialize(turns, query);
    // route() checks length, then coding, then fit: skip local model calls whose result cannot change the route.
    const long = exceedsLocalWords(query);
    const classification: Classification = long
      ? "uncertain"
      : await provider.classify(query, controller.signal);
    const fits =
      long || classification === "coding"
        ? true
        : await provider.fits(text, controller.signal).catch((e) => {
            if (controller.signal.aborted) throw e;
            return false;
          });
    const next = route(query, classification, fits, mode);
    if (mounted.current) setDecision(next);
    controller.signal.throwIfAborted();
    if (next.target === "blocked") throw new Error(next.reason);
    // Commit route disclosure to the UI before dispatching a generation request.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    return { next, text };
  };
  async function send(queryOverride?: string, retry = false) {
    if (!provider || !current || storageFailed || !onboarded) return;
    const query = (queryOverride ?? draft).trim();
    if (!query) return;
    const controller = acquire();
    if (!controller) return;
    let lastCheckpoint = 0;
    const chatId = current.id;
    let answerId = "";
    let text = "";
    let source: Source | undefined;
    let reason = "";
    try {
      const base = chatsRef.current.find((c) => c.id === chatId)!;
      let messages = base.messages;
      if (retry) {
        const lastUser = messages.findLastIndex((m) => m.role === "user");
        messages = messages.slice(0, lastUser);
      }
      const turns = completeTurns(messages);
      const user: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: query,
        createdAt: Date.now(),
        status: "complete",
      };
      await store(
        chatsRef.current.map((c) =>
          c.id !== chatId
            ? c
            : {
                ...c,
                title: c.messages.length ? c.title : query.slice(0, 48),
                messages: [...messages, user],
                updatedAt: Date.now(),
              },
        ),
      );
      setDrafts((previous) => ({ ...previous, [chatId]: "" }));
      const chosen = await decide(query, turns, controller);
      reason = chosen.next.reason;
      const answer: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        status: "interrupted",
        reason,
      };
      answerId = answer.id;
      await store(
        chatsRef.current.map((c) =>
          c.id !== chatId ? c : { ...c, messages: [...c.messages, answer] },
        ),
      );
      source = await provider.stream(
        chosen.text,
        chosen.next,
        controller.signal,
        (delta, actual) => {
          if (!mounted.current || controller.signal.aborted) return;
          text += delta;
          source = actual || source;
          const checkpoint = Date.now() - lastCheckpoint >= 250;
          if (checkpoint) lastCheckpoint = Date.now();
          void updateMessage(
            chatId,
            answerId,
            { content: text, source },
            checkpoint,
          ).catch(() => controller.abort());
        },
      );
      await updateMessage(
        chatId,
        answerId,
        { content: text, source, status: "complete" },
        true,
      );
    } catch (e) {
      if (answerId)
        await updateMessage(
          chatId,
          answerId,
          {
            content: text,
            source,
            reason,
            status: controller.signal.aborted ? "interrupted" : "error",
          },
          true,
        ).catch(() => undefined);
      if (mounted.current)
        setError(
          controller.signal.aborted
            ? "Generation stopped. A cloud request already sent may still complete."
            : errorText(e),
        );
    } finally {
      finish();
    }
  }
  async function saveRecovered(
    query: string,
    answer: string,
    source: Source | undefined,
    reason: string,
  ): Promise<string | undefined> {
    if (storageFailed) return;
    const now = Date.now();
    const chat: Chat = {
      id: crypto.randomUUID(),
      title: `Recovered · ${query.slice(0, 40)}`,
      createdAt: now,
      updatedAt: now,
      messages: [
        {
          id: crypto.randomUUID(),
          role: "user",
          content: query,
          createdAt: now,
          status: "complete",
        },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: answer,
          createdAt: now,
          status: "complete",
          source,
          reason,
        },
      ],
    };
    // Recovery's answer is shown either way; a failed save is surfaced by store().
    return store([chat, ...chatsRef.current]).then(
      () => chat.id,
      () => undefined,
    );
  }
  async function recover(attempt: Attempt, confirmed = false) {
    if (!provider || !onboarded) return;
    const controller = acquire();
    if (!controller) return;
    let claimed = false;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let text = "";
    let source: Source | undefined;
    let reason = "";
    seen.current.add(attempt.id);
    setView("recovery");
    const update = () => {
      const result: RecoveryResult = {
        id: attempt.id,
        tabId: attempt.tabId,
        query: attempt.query,
        text,
        source,
        reason,
        error: attempt.error || "",
        interrupted: true,
      };
      resultsRef.current = [
        ...resultsRef.current.filter((r) => r.id !== attempt.id),
        result,
      ];
      if (mounted.current) setResults(resultsRef.current);
    };
    try {
      const response = await request({
        type: "claim",
        id: attempt.id,
        owner,
        confirmed,
      });
      claimed = true;
      const active = response.attempt!;
      activeRecovery.current = {
        id: active.id,
        tabId: active.tabId,
        expiresAt: active.expiresAt,
      };
      expiryTimer = setTimeout(() => {
        controller.abort();
        resultsRef.current = resultsRef.current.filter(
          (r) => r.id !== active.id,
        );
        if (mounted.current) setResults(resultsRef.current);
      }, active.expiresAt - Date.now());
      source = await recoverNanoFirst(
        provider,
        active.query,
        active.snapshot.turns,
        {
          mode,
          online: navigator.onLine,
          signal: controller.signal,
          onPlan: (next) => {
            reason = next.reason;
            if (mounted.current) setDecision(next);
            update();
          },
          onText: (delta, actual) => {
            if (!mounted.current || controller.signal.aborted) return;
            text += delta;
            source = actual || source;
            update();
          },
        },
      );
      if (Date.now() >= active.expiresAt)
        throw new Error("Recovery prompt expired during generation.");
      activeRecovery.current = undefined;
      await request({ type: "complete", id: active.id, owner });
      // Keep the recovered exchange in chat history so it survives closing the panel.
      const chatId = await saveRecovered(active.query, text, source, reason);
      resultsRef.current = resultsRef.current.map((r) =>
        r.id === active.id ? { ...r, source, interrupted: false, chatId } : r,
      );
      if (mounted.current) setResults(resultsRef.current);
    } catch (e) {
      if (claimed)
        await request({ type: "release", id: attempt.id, owner }).catch(
          () => undefined,
        );
      setHeld((previous) => new Set(previous).add(attempt.id));
      if (mounted.current)
        setError(
          controller.signal.aborted
            ? "Recovery stopped. A cloud request already sent may still complete."
            : errorText(e),
        );
    } finally {
      clearTimeout(expiryTimer);
      activeRecovery.current = undefined;
      finish();
    }
  }
  // Start a recovery as soon as a failure is ready; never generate before ChatGPT has failed.
  useEffect(() => {
    if (!provider || busy || busyRef.current || !onboarded) return;
    const ready = attempts.find(
      (a) =>
        a.state === "failed" &&
        !seen.current.has(a.id) &&
        !held.has(a.id) &&
        a.expiresAt > Date.now(),
    );
    if (ready) void recover(ready);
  }, [attempts, busy, provider, onboarded, held, mode]);
  // Wake once at the next deadline (retry grace, claim lease, expiry) instead of polling every second.
  // The attempts request runs the background sweep; chrome.alarms may be clamped to 30s in packed builds.
  useEffect(() => {
    const start = Date.now();
    // Only future deadlines: dueAt stays set after an attempt fails, and past values would loop.
    const deadlines = attempts
      .flatMap((a) => [a.dueAt, a.claim?.until, a.expiresAt])
      .filter((t): t is number => t !== undefined && t > start);
    if (!deadlines.length) return;
    const timer = setTimeout(
      () => {
        setTick((n) => n + 1);
        void request({ type: "attempts" }).then(
          (res) => {
            if (mounted.current) setAttempts(res.attempts || []);
          },
          (e) => {
            if (mounted.current) setError(errorText(e));
          },
        );
      },
      Math.max(50, Math.min(...deadlines) - Date.now() + 50),
    );
    return () => clearTimeout(timer);
  }, [attempts]);
  async function prepare() {
    if (!provider) return;
    const controller = acquire();
    if (!controller) return;
    setProgress(0);
    try {
      await provider.prepare(setProgress);
      setAvailability(await provider.availability());
      setNotice("Gemini Nano is ready for on-device inference.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setProgress(undefined);
      finish();
    }
  }
  async function enableRecovery() {
    try {
      // permissions.request must be invoked directly from the user gesture.
      const granted = await chrome.permissions.request({
        origins: ["https://chatgpt.com/*"],
      });
      if (!granted) {
        setNotice(
          "Site access was not granted. Standalone chat remains available.",
        );
        return;
      }
      await request({ type: "enable" });
      setEnabled(true);
      setNotice(
        "Recovery enabled. Reload existing ChatGPT tabs to activate capture.",
      );
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function disableRecovery() {
    try {
      abort.current?.abort();
      await request({ type: "disable" });
      setEnabled(false);
      setAttempts([]);
      resultsRef.current = [];
      setResults([]);
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function dismiss(a: Attempt) {
    try {
      await request({ type: "dismiss", id: a.id });
      resultsRef.current = resultsRef.current.filter((r) => r.id !== a.id);
      setResults(resultsRef.current);
    } catch (e) {
      setError(errorText(e));
    }
  }
  const pending = attempts.filter((a) => a.error && a.expiresAt > Date.now());
  const lastUser = current?.messages.findLast((m) => m.role === "user");
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brandmark">
          <RotateCcw size={21} strokeWidth={2.5} />
        </div>
        <div className="brand">
          RouteBack<span>AI</span>
          <small>GOOD ANSWERS. FEWER LIMITS.</small>
        </div>
        <button
          className="icon-button settings-toggle"
          aria-label="Settings"
          onClick={() => setSettings(!settings)}
        >
          <Settings size={18} />
        </button>
      </header>
      {demo && (
        <div className="demo-banner">
          DEMO BUILD · simulated inference, no real AI calls
        </div>
      )}
      <nav className="tabs">
        <button
          className={view === "chat" ? "active" : ""}
          onClick={() => setView("chat")}
        >
          <MessageSquare size={15} />
          Chat
        </button>
        <button
          className={view === "recovery" ? "active" : ""}
          onClick={() => setView("recovery")}
        >
          <RotateCcw size={15} />
          Recovery
          {pending.length > 0 && (
            <span className="count">{pending.length}</span>
          )}
        </button>
      </nav>
      {!onboarded && loaded && (
        <section className="onboarding">
          <ShieldCheck size={24} />
          <h2>Your device first. Cloud when needed.</h2>
          <p>
            Auto sends coding requests, queries over 25 words, oversized
            context, or requests unsuitable for local AI to Gemini through
            Firebase. Local only never sends inference to cloud.
          </p>
          <p>
            Chat history is saved in this browser profile until deleted.
            Recovery captures visible ChatGPT text for up to five minutes and
            answers failed prompts with Gemini Nano on your device first.
            Missing history and attachments are not included.
          </p>
          <button
            className="primary"
            onClick={() => {
              void chrome.storage.local.set({ onboarded: true }).then(
                () => setOnboarded(true),
                (e) => setError(errorText(e)),
              );
            }}
          >
            Got it, let’s begin <ArrowUpRight size={16} />
          </button>
        </section>
      )}
      {settings && (
        <section className="settings-panel">
          <div className="section-heading">
            <h2>Workspace settings</h2>
            <button
              className="icon-button"
              aria-label="Close settings"
              onClick={() => setSettings(false)}
            >
              <X size={16} />
            </button>
          </div>
          <div className="setting-row">
            <div>
              <strong>Chrome Gemini Nano</strong>
              <small>
                {availability === "available"
                  ? "Ready on this device"
                  : availability}
              </small>
            </div>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void prepare()}
            >
              <Download size={14} />
              Set up
            </button>
          </div>
          {progress !== undefined && (
            <progress
              value={progress}
              max={1}
              aria-label="Model download progress"
            />
          )}
          <div className="setting-row">
            <div>
              <strong>ChatGPT recovery</strong>
              <small>Optional access to chatgpt.com</small>
            </div>
            <button
              className="secondary"
              onClick={() =>
                void (enabled ? disableRecovery() : enableRecovery())
              }
            >
              {enabled ? "Disable" : "Enable"}
            </button>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={!adapterEnabled}
              onChange={(e) => {
                const value = !e.target.checked;
                void request({ type: "adapter", enabled: value }).then(
                  () => setAdapterEnabled(value),
                  (e) => setError(errorText(e)),
                );
              }}
            />
            Confirm each captured ChatGPT prompt before answering it
          </label>
          <p className="fineprint">
            Off by default: failed prompts are answered with Gemini Nano as soon
            as you open the panel. Reload ChatGPT after enabling site access.
          </p>
          <div className="setting-row">
            <div>
              <strong>Firebase cloud</strong>
              <small>
                {demo
                  ? "Simulated for demo"
                  : configured && privateBuild
                    ? "Private build configured · verify App Check"
                    : "Requires private Firebase/App Check setup"}
              </small>
            </div>
            <Cloud size={17} />
          </div>
          <p className="fineprint">
            Saved chats are not synced or encrypted by this app. Firebase
            processing has its own retention policy. No analytics are installed.
          </p>
          <button
            className="danger-link"
            disabled={busy || storageFailed}
            onClick={() => {
              if (
                confirm("Delete all saved conversations from this browser?")
              ) {
                const fresh = newChat();
                void store([fresh])
                  .then(() => setCurrentId(fresh.id))
                  .catch(() => undefined);
              }
            }}
          >
            <Trash2 size={14} />
            Clear all saved chats
          </button>
        </section>
      )}
      {error && (
        <div role="alert" className="alert error">
          <span>{error}</span>
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="alert notice">
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notice"
            onClick={() => setNotice("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <div className="workspace-tools">
        <div className="status-dot" />
        <span>
          {availability === "available"
            ? "Gemini Nano ready"
            : "Local model setup needed"}
        </span>
        <label className="mode-select">
          <select
            aria-label="Inference mode"
            value={mode}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.value as Mode;
              setMode(next);
              void chrome.storage.local
                .set({ mode: next })
                .catch((e) => setError(errorText(e)));
            }}
          >
            <option value="auto">Auto · hybrid</option>
            <option value="local">Local only</option>
          </select>
          <ChevronDown size={12} />
        </label>
      </div>
      {view === "chat" ? (
        <>
          <div className="chat-tools">
            <button
              className="text-button"
              onClick={() => setHistory(!history)}
            >
              <History size={14} />
              {current?.title || "Conversations"}
              <ChevronDown size={12} />
            </button>
            <button
              className="icon-button"
              aria-label="New chat"
              disabled={busy || storageFailed || !loaded}
              onClick={() => {
                const next = newChat();
                setCurrentId(next.id);
                setHistory(false);
                void store([next, ...chatsRef.current]).catch(() => undefined);
              }}
            >
              <Plus size={18} />
            </button>
          </div>
          {history && (
            <div className="history-list">
              {chats.map((c) => (
                <div className="history-row" key={c.id}>
                  <button
                    disabled={busy}
                    className={c.id === currentId ? "selected" : ""}
                    onClick={() => {
                      setCurrentId(c.id);
                      setHistory(false);
                    }}
                  >
                    {c.title}
                    <small>{new Date(c.updatedAt).toLocaleDateString()}</small>
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Delete ${c.title}`}
                    disabled={busy || storageFailed}
                    onClick={() => {
                      const next = chatsRef.current.filter(
                        (x) => x.id !== c.id,
                      );
                      if (!next.length) next.push(newChat());
                      if (c.id === currentId) setCurrentId(next[0].id);
                      void store(next).catch(() => undefined);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <main className="messages">
            {!current?.messages.length ? (
              <div className="empty-chat">
                <div className="hero-icon">
                  <Leaf size={30} strokeWidth={1.5} />
                  <span className="spark">✦</span>
                </div>
                <div className="eyebrow">A LITTLE CLOSER TO HOME</div>
                <h1>
                  Big ideas.
                  <br />
                  <em>Smaller footprint.</em>
                </h1>
                <p>
                  Your everyday AI, right here in Chrome.
                  <br />
                  On your device when it fits.
                  <br />
                  In the cloud when you need more.
                </p>
                <div className="suggestions">
                  {[
                    "Explain something simply",
                    "Help me find the right words",
                    "Write a Python function",
                  ].map((label, i) => (
                    <button
                      key={label}
                      onClick={() =>
                        setDrafts((previous) => ({
                          ...previous,
                          [currentId]: [
                            "Why does the moon change shape?",
                            "Help me write a kind thank-you note.",
                            "Write a Python function to sort a list.",
                          ][i],
                        }))
                      }
                    >
                      {i === 2 ? <Cloud size={14} /> : <Zap size={14} />}
                      {label}
                      <ArrowUpRight size={13} />
                    </button>
                  ))}
                </div>
                <div className="privacy-note">
                  <ShieldCheck size={13} />
                  Local first. Always transparent.
                </div>
              </div>
            ) : (
              current.messages.map((message) => (
                <article className={`message ${message.role}`} key={message.id}>
                  <div className="message-heading">
                    {message.role === "user" ? (
                      "You"
                    ) : (
                      <>
                        <div className="mini-logo">
                          <RotateCcw size={12} />
                        </div>
                        RouteBackAI
                      </>
                    )}
                    <CopyButton text={message.content} />
                  </div>
                  <div className="markdown">
                    {message.content ? (
                      <Markdown text={message.content} />
                    ) : (
                      <span className="typing">
                        Working on it<span>•••</span>
                      </span>
                    )}
                  </div>
                  {message.role === "assistant" && (
                    <div className="message-meta">
                      {message.source === "IN_CLOUD" ? (
                        <Cloud size={12} />
                      ) : (
                        <Cpu size={12} />
                      )}
                      {sourceLabel(message.source)}
                      {message.status !== "complete" && (
                        <span>· {message.status}</span>
                      )}
                    </div>
                  )}
                  {message.reason && (
                    <p className="route-detail">{message.reason}</p>
                  )}
                </article>
              ))
            )}
            <div ref={end} />
          </main>
          <div className="composer-zone">
            {decision && (
              <div className={`route-status ${decision.target}`}>
                <span>
                  {decision.target === "cloud" ? (
                    <Cloud size={13} />
                  ) : (
                    <Cpu size={13} />
                  )}
                  {decision.reason}
                </span>
              </div>
            )}
            {lastUser && !busy && (
              <button
                className="retry-link"
                disabled={storageFailed}
                onClick={() => void send(lastUser.content, true)}
              >
                <RotateCcw size={12} />
                Retry latest query
              </button>
            )}
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <textarea
                aria-label="Message"
                placeholder="Ask anything. Start right here."
                value={draft}
                disabled={!loaded || storageFailed}
                rows={2}
                onChange={(e) =>
                  setDrafts((previous) => ({
                    ...previous,
                    [currentId]: e.target.value,
                  }))
                }
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="composer-bottom">
                <span>
                  {exceedsLocalWords(draft) ? (
                    <>
                      <Cloud size={12} />
                      Over {MAX_LOCAL_WORDS} words · cloud in Auto
                    </>
                  ) : (
                    <>
                      <Cpu size={12} />
                      {mode === "local"
                        ? "Local only"
                        : "Smart routing enabled"}
                    </>
                  )}
                </span>
                {busy ? (
                  <button
                    className="send stop"
                    type="button"
                    aria-label="Stop"
                    onClick={() => abort.current?.abort()}
                  >
                    <Square size={15} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    className="send"
                    type="submit"
                    aria-label="Send"
                    disabled={
                      !draft.trim() || !provider || !onboarded || storageFailed
                    }
                  >
                    <ArrowUp size={19} />
                  </button>
                )}
              </div>
            </form>
            <p className="composer-disclaimer">
              AI can make mistakes. Check important information.
            </p>
          </div>
        </>
      ) : (
        <main className="recovery-main">
          <div className="eyebrow">A SECOND WAY FORWARD</div>
          <h1>
            Cloud hiccup?
            <br />
            <em>Keep going.</em>
          </h1>
          <p className="intro">
            When ChatGPT can’t answer, your question doesn’t have to disappear.
          </p>
          {!enabled && (
            <section className="recovery-enable">
              <ShieldCheck size={25} />
              <h3>Give your questions a backup.</h3>
              <p>
                Enable capture on ChatGPT. Queries and visible conversation text
                expire after five minutes.
              </p>
              <button className="primary" onClick={() => void enableRecovery()}>
                Enable ChatGPT recovery <ArrowUpRight size={15} />
              </button>
            </section>
          )}
          {enabled && !pending.length && !results.length && (
            <section className="watching">
              <div className="radar">
                <RotateCcw size={24} />
              </div>
              <h3>Ready when you need it.</h3>
              <p>
                {attempts.length
                  ? `${attempts.length} query captured. Waiting for its request outcome.`
                  : "No failed queries. Continue using ChatGPT as usual."}
              </p>
              <small>Only matching generation failures trigger recovery.</small>
            </section>
          )}
          {pending.map((a) => (
            <section className="recovery-card" key={a.id}>
              <div className="recovery-error">
                <span className="status-dot amber" />
                {a.error}
                <span className="expiry">
                  <Countdown until={a.expiresAt} /> left
                </span>
              </div>
              <span className="eyebrow">STORED QUERY · TAB {a.tabId}</span>
              <div className="stored-query">
                {a.query}
                <CopyButton text={a.query} />
              </div>
              <details>
                <summary>
                  Visible conversation · {a.snapshot.turns.length} messages
                </summary>
                <p className="fineprint">
                  Snapshot only. Unloaded messages and attachments are missing.
                </p>
                {a.snapshot.turns.map((t, i) => (
                  <p className="context-turn" key={i}>
                    <strong>{t.role}</strong> {t.content}
                  </p>
                ))}
              </details>
              <div className="recovery-actions">
                <button
                  className="secondary"
                  disabled={
                    busy ||
                    a.state === "waiting" ||
                    a.state === "claimed" ||
                    !onboarded
                  }
                  onClick={() => {
                    setHeld((previous) => {
                      const next = new Set(previous);
                      next.delete(a.id);
                      return next;
                    });
                    void recover(a, a.state === "confirmation");
                  }}
                >
                  {a.state === "confirmation"
                    ? "Confirm prompt & recover"
                    : a.state === "waiting"
                      ? "Checking for retry…"
                      : a.state === "claimed"
                        ? "Generating…"
                        : "Retry recovery"}
                </button>
                <button
                  className="icon-button"
                  aria-label="Dismiss recovery"
                  disabled={a.state === "claimed"}
                  onClick={() => void dismiss(a)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </section>
          ))}
          {results.map((r) => (
            <section className="recovery-card result" key={r.id}>
              <div className="section-heading">
                <span className="eyebrow">RECOVERED ANSWER</span>
                <button
                  className="icon-button"
                  aria-label="Dismiss result"
                  disabled={busy}
                  onClick={() => {
                    resultsRef.current = resultsRef.current.filter(
                      (x) => x.id !== r.id,
                    );
                    setResults(resultsRef.current);
                  }}
                >
                  <X size={14} />
                </button>
              </div>
              <p className="fineprint">{r.error}</p>
              <blockquote>{r.query}</blockquote>
              <div className="markdown">
                <Markdown text={r.text || "Generating…"} />
              </div>
              <div className="message-meta">
                {r.source === "IN_CLOUD" ? (
                  <Cloud size={12} />
                ) : (
                  <Cpu size={12} />
                )}
                {sourceLabel(r.source)}
                {r.interrupted && <span>· in progress / interrupted</span>}
                <CopyButton text={r.text} />
              </div>
              <p className="route-detail">{r.reason}</p>
              {r.chatId && (
                <button
                  className="text-button"
                  onClick={() => {
                    setCurrentId(r.chatId!);
                    setView("chat");
                  }}
                >
                  <MessageSquare size={14} />
                  Saved to chat history · continue in Chat
                </button>
              )}
            </section>
          ))}
          {busy && (
            <button
              className="secondary"
              onClick={() => abort.current?.abort()}
            >
              <Square size={12} />
              Stop
            </button>
          )}
          <div ref={end} />
          {demo && (
            <button
              className="secondary demo-trigger"
              onClick={() => {
                void chrome.runtime.sendMessage({ type: "demo-failure" });
              }}
            >
              Simulate HTTP 503
            </button>
          )}
        </main>
      )}
      <footer>
        <span>
          <ShieldCheck size={12} />
          {mode === "local"
            ? "On-device inference only"
            : "Local first. Cloud when needed."}
        </span>
        <button
          className="icon-button"
          title="About routing"
          aria-label="About routing"
          onClick={() => {
            setSettings(true);
            setNotice(
              "Auto: over 25 words, coding, oversized context, or unavailable local classification → Firebase cloud. Local only never sends cloud inference.",
            );
          }}
        >
          <CircleHelp size={13} />
        </button>
      </footer>
      {busy && (
        <div className="sr-only" role="status">
          <LoaderCircle />
          Inference in progress
        </div>
      )}
    </div>
  );
}
