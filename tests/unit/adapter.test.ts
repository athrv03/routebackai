import { describe, expect, it } from "vitest";
import {
  extractQuery,
  isGenerationURL,
  validateBridge,
} from "../../src/shared/adapter";
import fixture from "../fixtures/chatgpt-payload.json";
describe("ChatGPT adapter boundary", () => {
  it("matches only explicit generation endpoints", () => {
    expect(
      isGenerationURL("https://chatgpt.com/backend-api/conversation"),
    ).toBe(true);
    expect(
      isGenerationURL("https://chatgpt.com/backend-api/f/conversation"),
    ).toBe(true);
    for (const value of [
      "https://chatgpt.com/backend-api/conversation/123",
      "https://chatgpt.com/backend-api/telemetry",
      "https://evil.test/backend-api/conversation",
      "https://chatgpt.com.evil.test/backend-api/conversation",
    ])
      expect(isGenerationURL(value)).toBe(false);
  });
  it("extracts plain text from the recognized payload only", () => {
    expect(extractQuery(fixture)).toEqual({
      query: "Why is the sky blue?",
      conversationId: "fixture-only",
    });
    expect(extractQuery({ ...fixture, action: "regenerate" })).toBeUndefined();
    expect(
      extractQuery({
        ...fixture,
        messages: [
          {
            ...fixture.messages[0],
            content: {
              content_type: "multimodal_text",
              parts: ["text", { image: "private" }],
            },
          },
        ],
      }),
    ).toBeUndefined();
  });
  it("rejects oversized, malformed and arbitrary page messages", () => {
    expect(validateBridge({ kind: "delete-all" })).toBe(false);
    expect(validateBridge({ kind: "outcome", id: "a", status: 503 })).toBe(
      true,
    );
    expect(validateBridge({ kind: "outcome", id: "a", status: 900 })).toBe(
      false,
    );
    expect(
      validateBridge({
        kind: "capture",
        capture: {
          id: "a",
          query: "hello",
          url: "https://chatgpt.com/backend-api/conversation",
          ambiguous: false,
          snapshot: { turns: [], incomplete: true },
        },
      }),
    ).toBe(true);
    expect(
      validateBridge({
        kind: "capture",
        capture: {
          id: "a",
          query: "x".repeat(180001),
          url: "https://chatgpt.com/backend-api/conversation",
          ambiguous: false,
          snapshot: { turns: [], incomplete: true },
        },
      }),
    ).toBe(false);
  });
});
