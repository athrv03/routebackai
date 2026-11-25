export type Mode = "auto" | "local";
export type Classification = "coding" | "non_coding" | "uncertain";
export type Source = "ON_DEVICE" | "IN_CLOUD";
export interface Turn {
  role: "user" | "assistant";
  content: string;
}
export interface ChatMessage extends Turn {
  id: string;
  createdAt: number;
  status: "complete" | "interrupted" | "error";
  source?: Source;
  reason?: string;
}
export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}
export interface Decision {
  target: "cloud" | "hybrid" | "local" | "blocked";
  reason: string;
}
export interface Snapshot {
  turns: Turn[];
  incomplete: true;
}
export interface Attempt {
  id: string;
  tabId: number;
  documentId: string;
  conversationId?: string;
  query: string;
  snapshot: Snapshot;
  url: string;
  createdAt: number;
  expiresAt: number;
  state: "pending" | "waiting" | "failed" | "claimed" | "confirmation";
  error?: string;
  dueAt?: number;
  claim?: { owner: string; until: number };
  /** Set once the ChatGPT tab has been shown the in-page recovery prompt. */
  notified?: boolean;
  requestId?: string;
}
export interface Capture {
  id: string;
  query: string;
  snapshot: Snapshot;
  url: string;
  conversationId?: string;
  ambiguous: boolean;
}
export type BridgeEvent =
  | { kind: "capture"; capture: Capture }
  | {
      kind: "outcome";
      id: string;
      status?: number;
      error?: "network" | "cancelled";
    };
export type PanelRequest =
  | { type: "attempts" }
  | { type: "claim"; id: string; owner: string; confirmed?: boolean }
  | { type: "release"; id: string; owner: string }
  | { type: "complete"; id: string; owner: string }
  | { type: "dismiss"; id: string }
  | { type: "enable" }
  | { type: "disable" }
  | { type: "status" }
  | { type: "adapter"; enabled: boolean };
export interface PanelResponse {
  ok: boolean;
  error?: string;
  attempts?: Attempt[];
  attempt?: Attempt;
  enabled?: boolean;
  adapterEnabled?: boolean;
}
export const TTL = 5 * 60_000;
export const GRACE = 3_000;
export const MAX_CAPTURE_CHARS = 180_000;
// ChatGPT failures worth answering locally: rate limiting and server errors.
export const RECOVERABLE_STATUS = [429, 500, 502, 503, 504];
export const isRecoverableStatus = (status?: number) =>
  status !== undefined && RECOVERABLE_STATUS.includes(status);
export const isClassification = (value: unknown): value is Classification =>
  value === "coding" || value === "non_coding" || value === "uncertain";
