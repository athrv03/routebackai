import type { Provider } from "./provider";
import { serialize } from "../shared/routing";
import type { Decision, Mode, Source, Turn } from "../shared/types";

// Recovery is Nano-first, except coding: in Auto while online, a coding prompt goes to Firebase
// cloud (Nano is weak at code). Everything else is answered on-device whenever Gemini Nano can take
// it. Offline or in Local only, Nano answers everything it can, including code.

export interface RecoveryPlan {
  text: string;
  decision: Decision;
}

/**
 * Keeps as much of the most recent visible context as fits Gemini Nano, halving the kept
 * turns until it fits. Returns undefined if Nano is unavailable or even the bare prompt is too big.
 */
export async function planOnDevice(
  provider: Provider,
  query: string,
  turns: Turn[],
  signal: AbortSignal,
): Promise<RecoveryPlan | undefined> {
  if ((await provider.availability()) !== "available") return;
  for (let keep = turns.length; ; keep = Math.floor(keep / 2)) {
    const text = serialize(turns.slice(turns.length - keep), query);
    const fits = await provider.fits(text, signal).catch((e) => {
      if (signal.aborted) throw e;
      return false;
    });
    if (fits) {
      const omitted = turns.length - keep;
      return {
        text,
        decision: {
          target: "local",
          reason: omitted
            ? `Answered on-device · ${omitted} earlier ChatGPT message${omitted === 1 ? "" : "s"} left out to fit Gemini Nano`
            : "Answered on-device · Gemini Nano first",
        },
      };
    }
    if (keep === 0) return;
  }
}

export async function recoverNanoFirst(
  provider: Provider,
  query: string,
  turns: Turn[],
  options: {
    mode: Mode;
    online: boolean;
    signal: AbortSignal;
    onPlan: (decision: Decision) => void;
    onText: (delta: string, source?: Source) => void;
  },
): Promise<Source> {
  const { mode, online, signal, onPlan, onText } = options;
  const cloudAllowed = mode === "auto" && online;
  const cloudText = serialize(turns, query);
  // Classify only when the answer could change the route; uncertain stays on-device.
  if (
    cloudAllowed &&
    (await provider.classify(query, signal)) === "coding"
  ) {
    const decision: Decision = {
      target: "cloud",
      reason: "Coding request · using Firebase cloud",
    };
    onPlan(decision);
    let emitted = false;
    try {
      return await provider.stream(cloudText, decision, signal, (d, s) => {
        emitted = true;
        onText(d, s);
      });
    } catch (error) {
      // Cloud failed before answering (not configured, App Check, network): try Nano instead.
      if (signal.aborted || emitted) throw error;
      const local = await planOnDevice(provider, query, turns, signal);
      if (!local) throw error;
      const fallback: Decision = {
        target: "local",
        reason: `Cloud unavailable for this coding request · ${local.decision.reason}`,
      };
      onPlan(fallback);
      return provider.stream(local.text, fallback, signal, onText);
    }
  }
  const local = await planOnDevice(provider, query, turns, signal);
  let reason: string;
  if (local) {
    onPlan(local.decision);
    let emitted = false;
    try {
      return await provider.stream(
        local.text,
        local.decision,
        signal,
        (delta, source) => {
          emitted = true;
          onText(delta, source);
        },
      );
    } catch (error) {
      // Never mix a partial on-device answer with a cloud one.
      if (signal.aborted || emitted || !cloudAllowed) throw error;
      reason = "Gemini Nano could not answer this prompt · using Firebase cloud";
    }
  } else if (!cloudAllowed) {
    throw new Error(
      mode === "local"
        ? "Gemini Nano isn't ready or can't fit this prompt, and Local only never uses cloud. Set up Gemini Nano in Settings."
        : "You're offline and Gemini Nano isn't ready or can't fit this prompt. Set up Gemini Nano in Settings.",
    );
  } else {
    reason =
      "Gemini Nano isn't available or can't fit this prompt · using Firebase cloud";
  }
  const decision: Decision = { target: "cloud", reason };
  onPlan(decision);
  return provider.stream(cloudText, decision, signal, onText);
}
