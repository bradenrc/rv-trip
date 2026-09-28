import type { IdeaCreateBody, SavedPlaceCreateInput } from "../domain/types";

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
 *
 * #113 (W3 Journal, Q5 A) widens the item to a discriminated union: besides a
 * save (`POST /api/places`) it carries a check-off PATCH (an idea, a stop or a
 * reservation) and a "Did it" idea (`POST /api/ideas`, born done), so a
 * check-off on a beach with no bars survives. A PATCH is idempotent by value;
 * a queued idea replays on its `clientId` (the server answers 200 with the row
 * that exists, like a save). The rules above are unchanged.
 */

/** AsyncStorage key. Bumped to v2 by #113: the item shape changed (a `kind`). */
export const CAPTURE_QUEUE_KEY = "rv.captureQueue.v2";

/** The pre-#113 key. Its items are read ONCE, as saves, then the key is cleared. */
export const CAPTURE_QUEUE_KEY_V1 = "rv.captureQueue.v1";

/** The POST /api/places body, with the client id every queued capture carries. */
export type CaptureBody = SavedPlaceCreateInput & { clientId: string };

/** What a check-off PATCH may carry — the "How was it?" sheet's fields. */
export interface JournalPatchBody {
  status?: "idea" | "planned" | "done";
  rating?: number | null;
  again?: boolean | null;
  notes?: string | null;
}

export type PatchEntity = "idea" | "stop" | "reservation";

interface QueuedBase {
  clientId: string;
  /** ISO instant the item was queued — the flush order. */
  queuedAt: string;
  /** Failed sends so far (5xx / network). Diagnostic only. */
  attempts: number;
}

/** A capture: `POST /api/places`. */
export interface QueuedSave extends QueuedBase {
  kind: "save";
  body: CaptureBody;
}

/** A check-off: `PATCH /api/{ideas,stops,reservations}/:id`. */
export interface QueuedPatch extends QueuedBase {
  kind: "patch";
  entity: PatchEntity;
  id: string;
  body: JournalPatchBody;
}

/** "Did it": `POST /api/ideas`, born done, idempotent on its clientId. */
export interface QueuedIdea extends QueuedBase {
  kind: "idea";
  body: IdeaCreateBody & { clientId: string; status: "done" };
}

export type QueuedItem = QueuedSave | QueuedPatch | QueuedIdea;

/** Kept for the capture call sites: a queued SAVE. */
export type QueuedCapture = QueuedSave;

export type CaptureQueue = readonly QueuedItem[];

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

/** Adds an item. A clientId already queued is not queued twice. */
export function enqueue(queue: CaptureQueue, item: QueuedItem): QueuedItem[] {
  if (queue.some((q) => q.clientId === item.clientId)) return [...queue];
  return [...queue, item];
}

/** The oldest capture by `queuedAt` (ties: the one queued first), or null. */
export function nextToFlush(queue: CaptureQueue): QueuedItem | null {
  let next: QueuedItem | null = null;
  for (const item of queue) {
    if (next === null || item.queuedAt < next.queuedAt) next = item;
  }
  return next;
}

/** A 2xx: the save exists on the server. */
export function markSent(queue: CaptureQueue, clientId: string): QueuedItem[] {
  return queue.filter((q) => q.clientId !== clientId);
}

/** How a send failed: an HTTP status, or no response at all. */
export type CaptureFailure = { status: number } | { network: true };

export interface FailedOutcome {
  queue: QueuedItem[];
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

type Raw = Record<string, unknown>;

/** One persisted item back into the union, or null when it cannot be one. An
 * item with no `kind` is a v1 capture — a save. */
function parseItem(q: unknown): QueuedItem | null {
  if (typeof q !== "object" || q === null) return null;
  const r = q as Raw;
  if (typeof r.clientId !== "string" || typeof r.queuedAt !== "string") return null;
  if (typeof r.body !== "object" || r.body === null) return null;
  const base = {
    clientId: r.clientId,
    queuedAt: r.queuedAt,
    attempts: typeof r.attempts === "number" ? r.attempts : 0,
  };
  const kind = r.kind ?? "save";
  if (kind === "save") return { ...base, kind: "save", body: r.body as CaptureBody };
  if (kind === "idea") return { ...base, kind: "idea", body: r.body as QueuedIdea["body"] };
  if (kind === "patch") {
    if (typeof r.id !== "string") return null;
    if (r.entity !== "idea" && r.entity !== "stop" && r.entity !== "reservation") return null;
    return { ...base, kind: "patch", entity: r.entity, id: r.id, body: r.body as JournalPatchBody };
  }
  // A kind from a future version: skipped, never a crash.
  return null;
}

/**
 * Reads the persisted array back. Anything unreadable — a missing key, a
 * hand-edited store, a shape from a future version — is an empty queue rather
 * than a crash; items without a client id or a body are skipped. A v1 item (no
 * `kind`) reads as a save.
 */
export function parseCaptureQueue(raw: string | null | undefined): QueuedItem[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.map(parseItem).filter((q): q is QueuedItem => q !== null);
}

/**
 * The v1 → v2 migration, on load: whatever sits under the v2 key, plus every
 * v1 item as a `kind: "save"`. A clientId in both is kept once (the v2 copy).
 * The caller persists the result under {@link CAPTURE_QUEUE_KEY} and clears
 * {@link CAPTURE_QUEUE_KEY_V1}.
 */
export function migrateCaptureQueue(
  v2Raw: string | null | undefined,
  v1Raw: string | null | undefined,
): QueuedItem[] {
  let queue = parseCaptureQueue(v2Raw);
  for (const item of parseCaptureQueue(v1Raw)) queue = enqueue(queue, item);
  return queue;
}

/** What `send` answers: the HTTP status and, on a 2xx, the parsed body. A
 * network failure is a THROW. */
export interface CaptureSendResult<T> {
  status: number;
  value?: T;
}

export interface FlushResult<T> {
  queue: QueuedItem[];
  /** The server's answer for every item that went through, in send order. */
  sent: { item: QueuedItem; value: T | undefined }[];
  dropped: QueuedItem[];
  /** True when a 5xx / network error ended the flush with items left. */
  stopped: boolean;
}

/**
 * Drains the queue through `send`, oldest first, one at a time, applying the
 * rules above. Returns the queue that is left for the caller to persist.
 */
export async function flushCaptureQueue<T>(
  queue: CaptureQueue,
  send: (item: QueuedItem) => Promise<CaptureSendResult<T>>,
): Promise<FlushResult<T>> {
  let left: QueuedItem[] = [...queue];
  const sent: FlushResult<T>["sent"] = [];
  const dropped: QueuedItem[] = [];
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
