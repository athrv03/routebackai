import { extractQuery, isGenerationURL } from "../shared/adapter";
import {
  MAX_CAPTURE_CHARS,
  type Snapshot,
  type BridgeEvent,
  type Turn,
} from "../shared/types";

const guard = "__routebackBridgeV1";
const page = window as typeof window & { [guard]?: boolean };
if (!page[guard]) {
  page[guard] = true;
  let monitoring = true;
  const emit = (event: BridgeEvent) => {
    if (monitoring)
      window.postMessage({ channel: "routeback-v1", event }, location.origin);
  };
  window.addEventListener("message", (event) => {
    if (
      event.source === window &&
      event.origin === location.origin &&
      event.data?.channel === "routeback-disable-v1"
    ) {
      monitoring = false;
      submission = undefined;
    }
  });
  let submission: { query: string; snapshot: Snapshot; at: number } | undefined;
  const visible = (el: HTMLElement) =>
    !!el.getClientRects().length &&
    getComputedStyle(el).visibility !== "hidden" &&
    !el.closest('[aria-hidden="true"], [hidden]');
  function captureSubmission() {
    if (!monitoring) return;
    const editor = document.querySelector<HTMLElement>("#prompt-textarea");
    const query =
      editor && visible(editor)
        ? (editor instanceof HTMLTextAreaElement
            ? editor.value
            : editor.innerText
          ).trim()
        : "";
    if (!query) return;
    const turns = [
      ...document.querySelectorAll<HTMLElement>("[data-message-author-role]"),
    ]
      .filter(visible)
      .flatMap<Turn>((el) => {
        const role = el.dataset.messageAuthorRole;
        if (role !== "user" && role !== "assistant") return [];
        // Scope to message text, excluding hidden nodes, attachments, controls, scripts and UI.
        const clone = el.cloneNode(true) as HTMLElement;
        const originals = [el, ...el.querySelectorAll<HTMLElement>("*")];
        const copies = [clone, ...clone.querySelectorAll<HTMLElement>("*")];
        originals.forEach((node, i) => {
          if (
            node !== el &&
            (!visible(node) ||
              node.matches(
                'button,input,textarea,script,style,[data-testid*="attachment"],img,svg',
              ))
          )
            copies[i]?.remove();
        });
        const content = clone.textContent?.trim() || "";
        return content ? [{ role, content }] : [];
      });
    const snapshot: Snapshot = { turns, incomplete: true };
    if (
      query.length + turns.reduce((n, t) => n + t.content.length, 0) >
        MAX_CAPTURE_CHARS ||
      turns.length > 500
    ) {
      submission = undefined;
      window.postMessage(
        {
          channel: "routeback-v1",
          notice:
            "Visible context is too large to capture safely. Copy the conversation into Chat manually.",
        },
        location.origin,
      );
      return;
    }
    submission = { query, snapshot, at: Date.now() };
    const captured = submission;
    setTimeout(() => {
      if (submission === captured) submission = undefined;
    }, 15_000);
  }
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.isComposing &&
        (event.target as Element)?.closest("#prompt-textarea")
      )
        captureSubmission();
    },
    true,
  );
  document.addEventListener(
    "click",
    (event) => {
      if (
        (event.target as Element)?.closest(
          '[data-testid="send-button"], button[aria-label="Send prompt"]',
        )
      )
        captureSubmission();
    },
    true,
  );
  document.addEventListener("submit", captureSubmission, true);
  const original = window.fetch;
  window.fetch = function (
    ...args: Parameters<typeof fetch>
  ): ReturnType<typeof fetch> {
    const [input, init] = args;
    const url =
      typeof input === "string"
        ? new URL(input, location.href).href
        : input instanceof URL
          ? input.href
          : input.url;
    if (
      !monitoring ||
      !isGenerationURL(url) ||
      (
        init?.method || (input instanceof Request ? input.method : "GET")
      ).toUpperCase() !== "POST"
    )
      return Reflect.apply(original, this, args);
    const id = crypto.randomUUID();
    const submitted = submission;
    // Inspect string payloads or a clone; never consume the original Request body.
    const bodyPromise =
      typeof init?.body === "string"
        ? Promise.resolve(init.body)
        : input instanceof Request && !init?.body
          ? input.clone().text()
          : Promise.resolve("");
    const captured = bodyPromise
      .then((text) => {
        if (text.length > MAX_CAPTURE_CHARS * 2) return false;
        let extracted;
        try {
          extracted = extractQuery(JSON.parse(text));
        } catch {
          return false;
        }
        if (!extracted) return false;
        const matched =
          !!submitted &&
          Date.now() - submitted.at < 15_000 &&
          submitted.query === extracted.query;
        emit({
          kind: "capture",
          capture: {
            id,
            ...extracted,
            url,
            snapshot: submitted?.snapshot || { turns: [], incomplete: true },
            ambiguous: !matched,
          },
        });
        return true;
      })
      .catch(() => false);
    // Start immediately; observation never delays dispatch or changes the returned promise.
    const response = Reflect.apply(original, this, args);
    void response.then(
      (result) => {
        void captured.then((ok) => {
          if (ok) emit({ kind: "outcome", id, status: result.status });
        });
      },
      (error) => {
        void captured.then((ok) => {
          if (ok)
            emit({
              kind: "outcome",
              id,
              error: error?.name === "AbortError" ? "cancelled" : "network",
            });
        });
      },
    );
    return response;
  };
}
