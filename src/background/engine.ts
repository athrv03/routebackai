import {
  GRACE,
  TTL,
  type Attempt,
  type Capture,
  type Classification,
} from "../shared/types";
export class RecoveryEngine {
  attempts: Attempt[];
  constructor(
    attempts: Attempt[] = [],
    private now: () => number = Date.now,
  ) {
    this.attempts = attempts;
    this.sweep();
  }
  /** Expires attempts and advances timed states. Returns whether anything changed. */
  sweep(): boolean {
    const now = this.now();
    const before = this.attempts.length;
    this.attempts = this.attempts.filter((a) => a.expiresAt > now);
    let changed = this.attempts.length !== before;
    for (const a of this.attempts) {
      if (a.state === "claimed" && a.claim && a.claim.until <= now) {
        a.state = "failed";
        delete a.claim;
        changed = true;
      }
      if (a.state === "waiting" && a.dueAt! <= now) {
        a.state = "failed";
        changed = true;
      }
    }
    return changed;
  }
  capture(c: Capture, tabId: number, documentId: string, verified: boolean) {
    this.sweep();
    if (this.attempts.some((a) => a.id === c.id && a.tabId === tabId)) return;
    // A new request with identical context replaces the failed retry candidate, not an unrelated request.
    this.attempts = this.attempts.filter(
      (a) =>
        !(
          a.tabId === tabId &&
          a.documentId === documentId &&
          a.query === c.query &&
          a.conversationId === c.conversationId &&
          a.snapshot.turns.length === c.snapshot.turns.length &&
          JSON.stringify(a.snapshot) === JSON.stringify(c.snapshot) &&
          (a.state === "waiting" || a.state === "failed")
        ),
    );
    if (this.attempts.length >= 12) this.attempts.shift();
    this.attempts.push({
      ...c,
      tabId,
      documentId,
      state: c.ambiguous || !verified ? "confirmation" : "pending",
      createdAt: this.now(),
      expiresAt: this.now() + TTL,
    });
  }
  outcome(
    id: string,
    tabId: number,
    documentId: string,
    status?: number,
    error?: string,
  ) {
    this.sweep();
    const a = this.attempts.find(
      (a) => a.id === id && a.tabId === tabId && a.documentId === documentId,
    );
    if (!a) return;
    if (
      (status && status >= 200 && status < 300) ||
      error === "cancelled" ||
      (status && ![500, 502, 503, 504].includes(status))
    ) {
      this.remove(id);
      return;
    }
    if (![500, 502, 503, 504].includes(status ?? 0) && error !== "network")
      return;
    if (a.state === "claimed" || a.error) return;
    a.error = status
      ? `ChatGPT returned HTTP ${status}`
      : "ChatGPT connection failed";
    if (a.state !== "confirmation") {
      a.state = "waiting";
      a.dueAt = this.now() + GRACE;
    }
  }
  classify(id: string, classification: Classification) {
    const a = this.attempts.find((a) => a.id === id);
    if (a) a.classification = classification;
  }
  claim(id: string, owner: string, confirmed = false): Attempt | undefined {
    this.sweep();
    const a = this.attempts.find((a) => a.id === id);
    if (
      !a ||
      !a.error ||
      !(a.state === "failed" || (a.state === "confirmation" && confirmed))
    )
      return;
    a.state = "claimed";
    a.claim = { owner, until: Math.min(a.expiresAt, this.now() + TTL) };
    return a;
  }
  release(id: string, owner: string) {
    const a = this.attempts.find(
      (a) => a.id === id && a.claim?.owner === owner,
    );
    if (a) {
      a.state = "failed";
      delete a.claim;
    }
  }
  complete(id: string, owner: string) {
    if (this.attempts.some((a) => a.id === id && a.claim?.owner === owner))
      this.remove(id);
  }
  releaseOwner(owner: string) {
    for (const a of this.attempts)
      if (a.claim?.owner === owner) this.release(a.id, owner);
  }
  remove(id: string) {
    this.attempts = this.attempts.filter((a) => a.id !== id);
  }
  removeTab(tabId: number) {
    this.attempts = this.attempts.filter((a) => a.tabId !== tabId);
  }
}
