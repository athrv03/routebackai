import type { Provider } from "./provider";
import type { Decision, Source } from "../shared/types";
// Included only in `--mode demo` builds. Never represents real inference.
export class DemoProvider implements Provider {
  async availability() {
    return "available";
  }
  async prepare(progress: (n: number) => void) {
    progress(1);
  }
  async classify(query: string) {
    return /code|coding|debug|javascript|python|function|```/i.test(query)
      ? ("coding" as const)
      : ("non_coding" as const);
  }
  async fits(text: string) {
    return text.length < 4096;
  }
  async stream(
    text: string,
    decision: Decision,
    signal: AbortSignal,
    onText: (delta: string, source: Source) => void,
  ): Promise<Source> {
    const source = decision.target === "cloud" ? "IN_CLOUD" : "ON_DEVICE";
    const query = JSON.parse(text.slice(text.indexOf("{"))).latestQuery;
    const answer = `**Demo response** · ${source === "ON_DEVICE" ? "Simulated Gemini Nano" : "Simulated Firebase cloud"}\n\nYou asked: ${query}\n\nThis deterministic demonstration verifies routing and streaming. It does not call a real model.`;
    for (const delta of answer.match(/.{1,12}|\n/g) || []) {
      signal.throwIfAborted();
      await new Promise((resolve) => setTimeout(resolve, 12));
      signal.throwIfAborted();
      onText(delta, source);
    }
    return source;
  }
}
