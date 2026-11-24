import { MAX_CAPTURE_CHARS, type BridgeEvent, type Turn } from "./types";
// This allowlist must be revalidated against a signed-in ChatGPT session before live recovery is enabled.
export function isGenerationURL(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === "https://chatgpt.com" &&
      /^\/backend-api\/(?:f\/)?conversation$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}
export function extractQuery(
  body: unknown,
): { query: string; conversationId?: string } | undefined {
  if (!body || typeof body !== "object") return;
  const b = body as Record<string, unknown>;
  if (
    b.action !== "next" ||
    !Array.isArray(b.messages) ||
    b.messages.length !== 1
  )
    return;
  const m = b.messages[0];
  if (
    m?.author?.role !== "user" ||
    m?.content?.content_type !== "text" ||
    !Array.isArray(m.content.parts) ||
    !m.content.parts.every((x: unknown) => typeof x === "string")
  )
    return;
  const query = m.content.parts.join("\n").trim();
  if (!query || query.length > MAX_CAPTURE_CHARS) return;
  return {
    query,
    conversationId:
      typeof b.conversation_id === "string" ? b.conversation_id : undefined,
  };
}
const isText = (x: unknown, limit = MAX_CAPTURE_CHARS): x is string =>
  typeof x === "string" && x.length <= limit;
function validTurn(t: unknown): t is Turn {
  if (!t || typeof t !== "object") return false;
  const v = t as Turn;
  return (v.role === "user" || v.role === "assistant") && isText(v.content);
}
export function validateBridge(value: unknown): value is BridgeEvent {
  if (!value || typeof value !== "object") return false;
  const v = value as BridgeEvent;
  if (v.kind === "outcome")
    return (
      isText(v.id, 100) &&
      v.id.length > 0 &&
      ((Number.isInteger(v.status) &&
        v.status! >= 100 &&
        v.status! <= 599 &&
        v.error === undefined) ||
        (v.status === undefined &&
          (v.error === "network" || v.error === "cancelled")))
    );
  if (v.kind !== "capture") return false;
  const c = v.capture;
  return (
    !!c &&
    isText(c.id, 100) &&
    c.id.length > 0 &&
    isText(c.query) &&
    !!c.query.trim() &&
    isText(c.url, 2048) &&
    isGenerationURL(c.url) &&
    typeof c.ambiguous === "boolean" &&
    (c.conversationId === undefined || isText(c.conversationId, 100)) &&
    c.snapshot?.incomplete === true &&
    Array.isArray(c.snapshot.turns) &&
    c.snapshot.turns.length <= 500 &&
    c.snapshot.turns.every(validTurn) &&
    c.query.length +
      c.snapshot.turns.reduce((n, t) => n + t.content.length, 0) <=
      MAX_CAPTURE_CHARS
  );
}
