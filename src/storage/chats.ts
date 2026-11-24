import type { Chat, ChatMessage } from "../shared/types";
const KEY = "routeback.chats.v1";
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
export async function loadChats(): Promise<Chat[]> {
  const value = (await chrome.storage.local.get(KEY))[KEY];
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    !value.every(
      (c) =>
        c &&
        typeof c.id === "string" &&
        typeof c.title === "string" &&
        Number.isFinite(c.createdAt) &&
        Number.isFinite(c.updatedAt) &&
        Array.isArray(c.messages) &&
        c.messages.every(validMessage),
    )
  )
    throw new Error(
      "Saved chats could not be read. Storage has not been overwritten.",
    );
  return value;
}
export async function saveChats(chats: Chat[]) {
  await chrome.storage.local.set({ [KEY]: chats });
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
