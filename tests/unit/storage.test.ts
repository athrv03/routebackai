import { afterEach, describe, expect, it, vi } from "vitest";
import { loadChats, newChat, saveChats } from "../../src/storage/chats";
afterEach(() => vi.unstubAllGlobals());
describe("saved chat storage", () => {
  it("persists only the supplied standalone chats", async () => {
    let saved: object = {};
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: async () => saved,
          set: async (value: object) => {
            saved = value;
          },
        },
      },
    });
    const chats = [newChat()];
    await saveChats(chats);
    expect(await loadChats()).toEqual(chats);
    expect(Object.keys(saved)).toEqual(["routeback.chats.v1"]);
    await saveChats([]);
    expect(await loadChats()).toEqual([]);
  });
  it("surfaces quota failure", async () => {
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          set: async () => {
            throw new Error("QUOTA_BYTES");
          },
        },
      },
    });
    await expect(saveChats([newChat()])).rejects.toThrow("QUOTA_BYTES");
  });
  it("refuses malformed history without overwriting it", async () => {
    const set = vi.fn();
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: async () => ({
            "routeback.chats.v1": [{ id: "broken", messages: null }],
          }),
          set,
        },
      },
    });
    await expect(loadChats()).rejects.toThrow("not been overwritten");
    expect(set).not.toHaveBeenCalled();
  });
});
