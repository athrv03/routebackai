import type { Chat, ChatMessage } from "../shared/types";
// v1 stored every chat under one key, so each streamed checkpoint rewrote all history.
// v2 keeps an ordered id index plus one key per chat, and writes only what changed.
const LEGACY = "routeback.chats.v1";
export const INDEX = "routeback.chats.v2";
export const chatKey = (id: string) => `routeback.chat.v2.${id}`;
const UNREADABLE =
  "Saved chats could not be read. Storage has not been overwritten.";
const validMessage = (m: ChatMessage) =>
  m &&
  typeof m.id === "string" &&
  (m.role === "user" || m.role === "assistant") &&
  typeof m.content === "string" &&
  Number.isFinite(m.createdAt) &&
  ["complete", "interrupted", "error"].includes(m.status) &&
  (m.source === undefined ||
    m.source === "ON_DEVICE" ||
    m.source === "IN_CLOUD") &&
  (m.reason === undefined || typeof m.reason === "string");
const validChat = (c: Chat) =>
  c &&
  typeof c.id === "string" &&
  typeof c.title === "string" &&
  Number.isFinite(c.createdAt) &&
  Number.isFinite(c.updatedAt) &&
  Array.isArray(c.messages) &&
  c.messages.every(validMessage);
export async function loadChats(): Promise<Chat[]> {
  const stored = await chrome.storage.local.get([INDEX, LEGACY]);
  const index = stored[INDEX];
  if (index === undefined) {
    const legacy = stored[LEGACY];
    if (legacy === undefined) return [];
    if (!Array.isArray(legacy) || !legacy.every(validChat))
      throw new Error(UNREADABLE);
    // One-time migration; the legacy key is removed only after v2 is written.
    await saveChats(legacy);
    return legacy;
  }
  if (!Array.isArray(index) || !index.every((id) => typeof id === "string"))
    throw new Error(UNREADABLE);
  const entries = await chrome.storage.local.get(index.map(chatKey));
  const chats = index.map((id: string) => entries[chatKey(id)] as Chat);
  if (!chats.every((c) => validChat(c))) throw new Error(UNREADABLE);
  return chats;
}
/**
 * Persists `chats`. With `previous` (the last saved list), only chats whose object
 * identity changed are written. Without it, everything is rewritten and stale keys removed.
 */
export async function saveChats(chats: Chat[], previous?: Chat[]) {
  const ids = chats.map((c) => c.id);
  const before = previous
    ? previous.map((c) => c.id)
    : ((await chrome.storage.local.get(INDEX))[INDEX] as string[] | undefined);
  const prior = new Map((previous ?? []).map((c) => [c.id, c]));
  const set: Record<string, unknown> = {};
  for (const c of chats) if (prior.get(c.id) !== c) set[chatKey(c.id)] = c;
  if (
    !previous ||
    ids.length !== before?.length ||
    ids.some((id, i) => before[i] !== id)
  )
    set[INDEX] = ids;
  if (Object.keys(set).length) await chrome.storage.local.set(set);
  const stale = (Array.isArray(before) ? before : [])
    .filter((id) => !ids.includes(id))
    .map(chatKey);
  if (!previous) stale.push(LEGACY);
  if (stale.length) await chrome.storage.local.remove(stale);
}
export function newChat(): Chat {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: "New conversation",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}
