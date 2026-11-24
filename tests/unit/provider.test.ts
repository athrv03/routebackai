import { afterEach, describe, expect, it, vi } from "vitest";
import { FirebaseProvider, normalizeSource } from "../../src/ai/provider";
const controller = () => new AbortController();
afterEach(() => vi.unstubAllGlobals());
describe("Firebase local-only safety", () => {
  it("never calls fetch for classification or local generation when LanguageModel is absent", async () => {
    vi.stubGlobal("LanguageModel", undefined);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const p = new FirebaseProvider();
    expect(await p.classify("hello", controller().signal)).toBe("uncertain");
    await expect(
      p.stream(
        "hello",
        { target: "local", reason: "local" },
        controller().signal,
        vi.fn(),
      ),
    ).rejects.toThrow("no cloud request");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("never invokes cloud when model availability is unsupported", async () => {
    vi.stubGlobal("LanguageModel", { availability: async () => "unavailable" });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const p = new FirebaseProvider();
    expect(await p.classify("Write code", controller().signal)).toBe(
      "uncertain",
    );
    await expect(
      p.stream(
        "hello",
        { target: "local", reason: "local" },
        controller().signal,
        vi.fn(),
      ),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("measures native input plus output headroom and destroys measurement sessions", async () => {
    const destroy = vi.fn();
    vi.stubGlobal("LanguageModel", {
      availability: async () => "available",
      create: async () => ({
        inputQuota: 5000,
        measureInputUsage: async () => 3500,
        destroy,
      }),
    });
    expect(
      await new FirebaseProvider().fits(
        "large visible context",
        controller().signal,
      ),
    ).toBe(false);
    expect(destroy).toHaveBeenCalledOnce();
  });
  it("uses a conservative byte bound without native measurement", async () => {
    vi.stubGlobal("LanguageModel", {
      availability: async () => "available",
      create: async () => ({ destroy: vi.fn() }),
    });
    const p = new FirebaseProvider();
    expect(await p.fits("x".repeat(4096), controller().signal)).toBe(true);
    expect(await p.fits("é".repeat(4096), controller().signal)).toBe(false);
  });
  it("normalizes actual SDK inference-source values", () => {
    expect(normalizeSource("on_device")).toBe("ON_DEVICE");
    expect(normalizeSource("in_cloud")).toBe("IN_CLOUD");
    expect(normalizeSource(undefined)).toBeUndefined();
  });
  it("honors an aborted local classification without dispatch", async () => {
    vi.stubGlobal("LanguageModel", { availability: async () => "available" });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const c = controller();
    c.abort();
    await expect(
      new FirebaseProvider().classify("hello", c.signal),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("installed Firebase SDK compatibility", () => {
  it("runs classification through the real Firebase adapter without a fetch", async () => {
    const prompt = vi.fn(async () => '{"category":"coding"}');
    vi.stubGlobal("LanguageModel", {
      availability: async () => "available",
      create: async () => ({ prompt, destroy: vi.fn() }),
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      await new FirebaseProvider().classify(
        "Write Python code",
        new AbortController().signal,
      ),
    ).toBe("coding");
    expect(prompt).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("streams through the real Firebase adapter with actual on-device attribution", async () => {
    vi.stubGlobal("LanguageModel", {
      availability: async () => "available",
      create: async () => ({
        promptStreaming: () =>
          new ReadableStream({
            start(c) {
              c.enqueue("hello ");
              c.enqueue("world");
              c.close();
            },
          }),
        destroy: vi.fn(),
      }),
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const chunks: string[] = [];
    const source = await new FirebaseProvider().stream(
      "Hello",
      { target: "local", reason: "Local only" },
      new AbortController().signal,
      (delta) => chunks.push(delta),
    );
    expect(source).toBe("ON_DEVICE");
    expect(chunks.join("")).toBe("hello world");
    expect(fetch).not.toHaveBeenCalled();
  });
});


describe('current Chrome context measurement', () => {
  it('uses measureContextUsage on current Chrome instead of a legacy estimate', async () => {
    const measure = vi.fn(async () => 1000);
    vi.stubGlobal('LanguageModel', { availability: async () => 'available', create: async () => ({ contextWindow: 8192, measureContextUsage: measure, destroy: vi.fn() }) });
    expect(await new FirebaseProvider().fits('history '.repeat(1000), new AbortController().signal)).toBe(true);
    expect(measure).toHaveBeenCalledOnce();
  });
});
