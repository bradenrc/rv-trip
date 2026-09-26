import type { SavedPlaceCreateInput } from "../domain/types";

/**
 * The phone's capture queue (#111 · docs/design/111 #100 "offline").
 *
 * Every capture is written to the queue FIRST and then sent, online or not, so
 * "saved" never depends on signal. The rules live here, pure, because
 * `apps/mobile` has no test runner: the phone only persists the array (under
 * {@link CAPTURE_QUEUE_KEY} in AsyncStorage) and hands {@link flushCaptureQueue}
 * a `send`.
 *
 * - Items go oldest first, one at a time.
 * - A 2xx removes the item. (A replay of a sent-but-unacknowledged item is a
 *   200 with the row that already exists — the server is idempotent on
 *   `clientId` — so re-sending is always safe.)
 * - A 4xx DROPS it: the server has refused that body and will refuse it again;
 *   keeping it would wedge every capture queued behind it.
 * - A 5xx or a network error KEEPS it and stops the flush: the next trigger
 *   (back online, app foreground, the next enqueue) tries again from the top.
 */

/** AsyncStorage key. Bump the suffix if the item shape ever changes. */
export const CAPTURE_QUEUE_KEY = "rv.captureQueue.v1";

/** The POST /api/places body, with the client id every queued capture carries. */
export type CaptureBody = SavedPlaceCreateInput & { clientId: string };

export interface QueuedCapture {
  clientId: string;
  /** ISO instant the capture was queued — the flush order. */
  queuedAt: string;
  body: CaptureBody;
  /** Failed sends so far (5xx / network). Diagnostic only. */
  attempts: number;
}

export type CaptureQueue = readonly QueuedCapture[];

/**
 * `cap_<time><random>` — minted once, when the capture is created, so every
 * retry of the same capture is the same save. Time-prefixed so ids sort
 * roughly by birth; the random tail makes two captures in one millisecond
 * distinct. Not a UUID on purpose: Hermes has no `crypto.randomUUID`.
 */
export function newClientId(now: number = Date.now(), random: () => number = Math.random): string {
  const tail = Array.from({ length: 8 }, () => Math.floor(random() * 36).toString(36)).join("");
  return `cap_${now.toString(36)}${tail}`;
}

/** Adds a capture. A clientId already queued is not queued twice. */
export function enqueue(queue: CaptureQueue, item: QueuedCapture): QueuedCapture[] {
  if (queue.some((q) => q.clientId === item.clientId)) return [...queue];
  return [...queue, item];
}

/** The oldest capture by `queuedAt` (ties: the one queued first), or null. */
export function nextToFlush(queue: CaptureQueue): QueuedCapture | null {
  let next: QueuedCapture | null = null;
  for (const item of queue) {
    if (next === null || item.queuedAt < next.queuedAt) next = item;
  }
  return next;
}

/** A 2xx: the save exists on the server. */
export function markSent(queue: CaptureQueue, clientId: string): QueuedCapture[] {
  return queue.filter((q) => q.clientId !== clientId);
}

/** How a send failed: an HTTP status, or no response at all. */
export type CaptureFailure = { status: number } | { network: true };

export interface FailedOutcome {
  queue: QueuedCapture[];
  /** 4xx — the item is gone for good. */
  dropped: boolean;
  /** 5xx / network — stop this flush and wait for the next trigger. */
  stop: boolean;
}

export function markFailed(
  queue: CaptureQueue,
  clientId: string,
  failure: CaptureFailure,
): FailedOutcome {
  const client = "status" in failure && failure.status >= 400 && failure.status < 500;
  if (client) return { queue: markSent(queue, clientId), dropped: true, stop: false };
  return {
    queue: queue.map((q) => (q.clientId === clientId ? { ...q, attempts: q.attempts + 1 } : q)),
    dropped: false,
    stop: true,
  };
}

/**
 * Reads the persisted array back. Anything unreadable — a missing key, a
 * hand-edited store, a shape from a future version — is an empty queue rather
 * than a crash; items without a client id or a body are skipped.
 */
export function parseCaptureQueue(raw: string | null | undefined): QueuedCapture[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.filter(
    (q): q is QueuedCapture =>
      typeof q === "object" &&
      q !== null &&
      typeof (q as QueuedCapture).clientId === "string" &&
      typeof (q as QueuedCapture).queuedAt === "string" &&
      typeof (q as QueuedCapture).body === "object" &&
      (q as QueuedCapture).body !== null,
  ).map((q) => ({ ...q, attempts: typeof q.attempts === "number" ? q.attempts : 0 }));
}

/** What `send` answers: the HTTP status and, on a 2xx, the parsed body. A
 * network failure is a THROW. */
export interface CaptureSendResult<T> {
  status: number;
  value?: T;
}

export interface FlushResult<T> {
  queue: QueuedCapture[];
  /** The server's answer for every item that went through, in send order. */
  sent: { item: QueuedCapture; value: T | undefined }[];
  dropped: QueuedCapture[];
  /** True when a 5xx / network error ended the flush with items left. */
  stopped: boolean;
}

/**
 * Drains the queue through `send`, oldest first, one at a time, applying the
 * rules above. Returns the queue that is left for the caller to persist.
 */
export async function flushCaptureQueue<T>(
  queue: CaptureQueue,
  send: (item: QueuedCapture) => Promise<CaptureSendResult<T>>,
): Promise<FlushResult<T>> {
  let left: QueuedCapture[] = [...queue];
  const sent: FlushResult<T>["sent"] = [];
  const dropped: QueuedCapture[] = [];
  for (let item = nextToFlush(left); item; item = nextToFlush(left)) {
    let failure: CaptureFailure | null = null;
    let value: T | undefined;
    try {
      const res = await send(item);
      if (res.status >= 200 && res.status < 300) value = res.value;
      else failure = { status: res.status };
    } catch {
      failure = { network: true };
    }
    if (!failure) {
      left = markSent(left, item.clientId);
      sent.push({ item, value });
      continue;
    }
    const out = markFailed(left, item.clientId, failure);
    left = out.queue;
    if (out.dropped) dropped.push(item);
    if (out.stop) return { queue: left, sent, dropped, stopped: true };
  }
  return { queue: left, sent, dropped, stopped: false };
}
