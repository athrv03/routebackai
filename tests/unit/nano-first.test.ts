import { describe, expect, it, vi } from "vitest";
import { planOnDevice, recoverNanoFirst } from "../../src/ai/recovery";
import type { Provider } from "../../src/ai/provider";
import type { Decision, Turn } from "../../src/shared/types";

const turns: Turn[] = Array.from({ length: 8 }, (_, i) => ({
  role: i % 2 ? "assistant" : "user",
  content: `message ${i}`,
}));
function fake(options: {
  availability?: string;
  maxTurns?: number;
  localFails?: boolean;
}): Provider & { stream: ReturnType<typeof vi.fn> } {
  const { availability = "available", maxTurns = Infinity } = options;
  return {
    availability: async () => availability,
    prepare: async () => undefined,
    classify: vi.fn(async () => "coding" as const),
    fits: async (text: string) =>
      JSON.parse(text.slice(text.indexOf("{"))).conversation.length <= maxTurns,
    stream: vi.fn(async (_text: string, decision: Decision, _s, onText) => {
      if (decision.target === "local" && options.localFails)
        throw new Error("nano failed");
      onText("answer");
      return decision.target === "cloud" ? "IN_CLOUD" : "ON_DEVICE";
    }),
  };
}
const run = (
  provider: Provider,
  mode: "auto" | "local" = "auto",
  online = true,
  query = "Write a Python quicksort",
) => {
  const plans: Decision[] = [];
  return recoverNanoFirst(provider, query, turns, {
    mode,
    online,
    signal: new AbortController().signal,
    onPlan: (d) => plans.push(d),
    onText: () => undefined,
  }).then((source) => ({ source, plans }));
};

describe("Nano-first recovery", () => {
  it("sends coding to cloud when online in Auto, everything else on-device", async () => {
    const coding = fake({});
    const { source, plans } = await run(coding);
    expect(source).toBe("IN_CLOUD");
    expect(plans[0].reason).toContain("Coding request");
    const general = fake({});
    general.classify = vi.fn(async () => "non_coding" as const);
    const long = Array(60).fill("word").join(" ");
    expect((await run(general, "auto", true, long)).source).toBe("ON_DEVICE");
  });
  it("answers coding on-device when offline or Local only, without classifying", async () => {
    for (const [mode, online] of [["auto", false], ["local", true]] as const) {
      const provider = fake({});
      expect((await run(provider, mode, online)).source).toBe("ON_DEVICE");
      expect(provider.classify).not.toHaveBeenCalled();
    }
  });
  it("falls back to Nano when cloud fails for a coding prompt", async () => {
    const provider = fake({});
    provider.stream.mockImplementationOnce(async () => {
      throw new Error("App Check");
    });
    const { source, plans } = await run(provider);
    expect(source).toBe("ON_DEVICE");
    expect(plans.map((p) => p.target)).toEqual(["cloud", "local"]);
    expect(plans[1].reason).toContain("Cloud unavailable");
  });
  it("keeps the most recent context that fits and says what was left out", async () => {
    const plan = await planOnDevice(
      fake({ maxTurns: 3 }),
      "q",
      turns,
      new AbortController().signal,
    );
    const kept = JSON.parse(plan!.text.slice(plan!.text.indexOf("{")));
    expect(kept.conversation).toEqual(turns.slice(-2));
    expect(plan!.decision.reason).toContain("6 earlier ChatGPT messages");
  });
  it("falls back to cloud only in Auto while online", async () => {
    const nonCoding = (p: ReturnType<typeof fake>) => {
      p.classify = vi.fn(async () => "non_coding" as const);
      return p;
    };
    expect((await run(nonCoding(fake({ availability: "downloadable" })))).source).toBe(
      "IN_CLOUD",
    );
    expect((await run(nonCoding(fake({ localFails: true })))).plans.map((p) => p.target))
      .toEqual(["local", "cloud"]);
    await expect(
      run(fake({ availability: "unavailable" }), "auto", false),
    ).rejects.toThrow("offline");
    await expect(
      run(fake({ availability: "unavailable" }), "local"),
    ).rejects.toThrow("Local only never uses cloud");
    await expect(run(fake({ localFails: true }), "local")).rejects.toThrow(
      "nano failed",
    );
  });
});
