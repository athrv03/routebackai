import { beforeEach, describe, expect, it } from "vitest";
import { RecoveryEngine } from "../../src/background/engine";
import { GRACE, TTL, type Capture } from "../../src/shared/types";
const capture = (id = "attempt", query = "Explain gravity"): Capture => ({
  id,
  query,
  snapshot: { turns: [], incomplete: true },
  url: "https://chatgpt.com/backend-api/conversation",
  ambiguous: false,
});
let now: number;
let engine: RecoveryEngine;
beforeEach(() => {
  now = 10000;
  engine = new RecoveryEngine([], () => now);
});
describe("recovery lifecycle", () => {
  it.each([500, 502, 503, 504])("recovers %i after retry grace", (status) => {
    engine.capture(capture(), 1, "doc", true);
    engine.outcome("attempt", 1, "doc", status);
    expect(engine.claim("attempt", "panel")).toBeUndefined();
    now += GRACE;
    engine.sweep();
    expect(engine.claim("attempt", "panel")?.error).toContain(String(status));
    expect(engine.claim("attempt", "another-panel")).toBeUndefined();
    engine.complete("attempt", "another-panel");
    expect(engine.attempts).toHaveLength(1);
    engine.complete("attempt", "panel");
    expect(engine.attempts).toHaveLength(0);
  });
  it.each([200, 201, 204, 304, 401, 403, 429])(
    "does not recover HTTP %i",
    (status) => {
      engine.capture(capture(), 1, "doc", true);
      engine.outcome("attempt", 1, "doc", status);
      expect(engine.attempts).toHaveLength(0);
    },
  );
  it("uses a grace period for transport failures, ignores cancellation", () => {
    engine.capture(capture(), 1, "doc", true);
    engine.outcome("attempt", 1, "doc", undefined, "network");
    expect(engine.attempts[0].state).toBe("waiting");
    engine.capture(capture("cancelled", "another"), 1, "doc", true);
    engine.outcome("cancelled", 1, "doc", undefined, "cancelled");
    expect(engine.attempts).toHaveLength(1);
  });
  it("a successful retry removes a failed candidate without changing another tab", () => {
    engine.capture(capture(), 1, "doc", true);
    engine.outcome("attempt", 1, "doc", 503);
    engine.capture(capture("other"), 2, "doc2", true);
    engine.capture(capture("retry"), 1, "doc", true);
    engine.outcome("retry", 1, "doc", 200);
    expect(engine.attempts.map((a) => a.id)).toEqual(["other"]);
  });
  it("does not conflate identical text with different visible context", () => {
    engine.capture(capture(), 1, "doc", true);
    engine.outcome("attempt", 1, "doc", 503);
    const next = capture("different");
    next.snapshot.turns.push({ role: "assistant", content: "new context" });
    engine.capture(next, 1, "doc", true);
    expect(engine.attempts).toHaveLength(2);
  });
  it("requires confirmation for an unverified adapter or ambiguous submission", () => {
    engine.capture(capture(), 1, "doc", false);
    engine.outcome("attempt", 1, "doc", 503);
    now += GRACE;
    expect(engine.claim("attempt", "panel")).toBeUndefined();
    expect(engine.claim("attempt", "panel", true)).toBeDefined();
  });
  it("ignores a different document and deduplicates outcome signals", () => {
    engine.capture(capture(), 1, "doc", true);
    engine.outcome("attempt", 1, "other", 503);
    expect(engine.attempts[0].error).toBeUndefined();
    engine.outcome("attempt", 1, "doc", 503);
    now += 500;
    engine.outcome("attempt", 1, "doc", 503);
    expect(engine.attempts[0].dueAt).toBe(13000);
  });
  it("enforces TTL across worker restart and releases disconnected owners", () => {
    engine.capture(capture(), 1, "doc", true);
    engine.outcome("attempt", 1, "doc", 503);
    now += GRACE;
    engine.claim("attempt", "panel");
    engine.releaseOwner("panel");
    expect(engine.attempts[0].state).toBe("failed");
    const restored = new RecoveryEngine(
      JSON.parse(JSON.stringify(engine.attempts)),
      () => now,
    );
    expect(restored.claim("attempt", "new-panel")).toBeDefined();
    now += TTL;
    expect(restored.claim("attempt", "new-panel")).toBeUndefined();
    expect(restored.attempts).toHaveLength(0);
  });
  it("removes only a closed tab and never claims a successful pending request", () => {
    engine.capture(capture(), 1, "doc", true);
    engine.capture(capture("other"), 2, "doc2", true);
    expect(engine.claim("attempt", "panel")).toBeUndefined();
    engine.removeTab(1);
    expect(engine.attempts[0].tabId).toBe(2);
  });
});
