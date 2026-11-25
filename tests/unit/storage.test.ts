import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INDEX,
  chatKey,
  loadChats,
  newChat,
  saveChats,
} from "../../src/storage/chats";
afterEach(() => vi.unstubAllGlobals());
// Minimal chrome.storage.local with merge/remove semantics.
function memoryStorage(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  const set = vi.fn(async (value: Record<string, unknown>) => {
    Object.assign(data, structuredClone(value));
  });
  const remove = vi.fn(async (keys: string | string[]) => {
    for (const k of [keys].flat()) delete data[k];
  });
  const get = async (keys: string | string[]) =>
    Object.fromEntries(
      [keys]
        .flat()
        .filter((k) => k in data)
        .map((k) => [k, structuredClone(data[k])]),
    );
  vi.stubGlobal("chrome", { storage: { local: { get, set, remove } } });
  return { data, set, remove };
}
describe("saved chat storage", () => {
  it("persists only the supplied standalone chats", async () => {
    const store = memoryStorage();
    const chats = [newChat()];
    await saveChats(chats);
    expect(await loadChats()).toEqual(chats);
    expect(Object.keys(store.data).sort()).toEqual(
      [INDEX, chatKey(chats[0].id)].sort(),
    );
    await saveChats([]);
    expect(await loadChats()).toEqual([]);
    expect(Object.keys(store.data)).toEqual([INDEX]);
  });
  it("writes only changed chats when diffing against the last save", async () => {
    const store = memoryStorage();
    const a = newChat(),
      b = newChat();
    await saveChats([a, b]);
    store.set.mockClear();
    const edited = { ...b, title: "Edited" };
    await saveChats([a, edited], [a, b]);
    expect(store.set).toHaveBeenCalledTimes(1);
    expect(Object.keys(store.set.mock.calls[0][0])).toEqual([chatKey(b.id)]);
    await saveChats([edited], [a, edited]);
    expect(store.data[chatKey(a.id)]).toBeUndefined();
    expect(await loadChats()).toEqual([edited]);
  });
  it("migrates v1 single-key history", async () => {
    const chat = newChat();
    const store = memoryStorage({ "routeback.chats.v1": [chat] });
    expect(await loadChats()).toEqual([chat]);
    expect(store.data["routeback.chats.v1"]).toBeUndefined();
    expect(store.data[INDEX]).toEqual([chat.id]);
    expect(await loadChats()).toEqual([chat]);
  });
  it("surfaces quota failure", async () => {
    memoryStorage().set.mockRejectedValue(new Error("QUOTA_BYTES"));
    await expect(saveChats([newChat()])).rejects.toThrow("QUOTA_BYTES");
  });
  it("refuses malformed history without overwriting it", async () => {
    for (const initial of [
      { "routeback.chats.v1": [{ id: "broken", messages: null }] },
      { [INDEX]: ["missing"] },
    ]) {
      const store = memoryStorage(initial);
      await expect(loadChats()).rejects.toThrow("not been overwritten");
      expect(store.set).not.toHaveBeenCalled();
      expect(store.remove).not.toHaveBeenCalled();
    }
  });
});
