import { describe, expect, it } from "vitest";
import {
  classificationFromJSON,
  completeTurns,
  route,
  serialize,
  wordCount,
} from "../../src/shared/routing";
import type { ChatMessage } from "../../src/shared/types";
describe("hybrid routing", () => {
  it("routes 25 words locally and 26 to cloud", () => {
    const query = Array(25).fill("word").join(" ");
    expect(wordCount(` \n ${query}\t`)).toBe(25);
    expect(route(query, "non_coding", true, "auto").target).toBe("hybrid");
    expect(route(`${query} extra`, "non_coding", true, "auto").target).toBe(
      "cloud",
    );
  });
  it.each(["coding", "uncertain"] as const)(
    "routes %s to cloud or blocks local only",
    (category) => {
      expect(route("short", category, true, "auto").target).toBe("cloud");
      expect(route("short", category, true, "local").target).toBe("blocked");
    },
  );
  it("routes oversized history to cloud without shortening it", () => {
    expect(route("short", "non_coding", false, "auto").target).toBe("cloud");
    const text = "long context ".repeat(20000);
    expect(serialize([{ role: "user", content: text }], "short")).toContain(
      text,
    );
  });
  it("does not override local-only mode", () => {
    expect(route("short", "non_coding", true, "local").target).toBe("local");
    expect(route("short", "non_coding", false, "local").target).toBe("blocked");
  });
  it("accepts only the classifier schema", () => {
    expect(classificationFromJSON('{"category":"coding"}')).toBe("coding");
    for (const value of [
      '```json\n{"category":"coding"}\n```',
      '{"category":"safe"}',
      '{"category":"coding","injected":true}',
      "{}",
    ])
      expect(classificationFromJSON(value)).toBe("uncertain");
  });
  it("replays complete pairs but excludes interrupted responses and orphaned queries", () => {
    const msg = (
      role: "user" | "assistant",
      content: string,
      status: ChatMessage["status"] = "complete",
    ): ChatMessage => ({ id: content, role, content, status, createdAt: 0 });
    expect(
      completeTurns([
        msg("user", "first"),
        msg("assistant", "done"),
        msg("user", "second"),
        msg("assistant", "partial", "interrupted"),
        msg("user", "orphan"),
      ]),
    ).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "done" },
    ]);
  });
});
