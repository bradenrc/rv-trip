import { describe, it, expect } from "vitest";
import {
  CAPTURE_QUEUE_KEY,
  CAPTURE_QUEUE_KEY_V1,
  enqueue,
  flushCaptureQueue,
  markFailed,
  markSent,
  migrateCaptureQueue,
  newClientId,
  nextToFlush,
  parseCaptureQueue,
  type QueuedCapture,
  type QueuedIdea,
  type QueuedItem,
  type QueuedPatch,
} from "./queue";

// docs/design/111 #100 offline: oldest first, one at a time; 2xx removes,
// 4xx drops, 5xx / network keeps the item and stops the flush.

const item = (clientId: string, queuedAt: string, name = clientId): QueuedCapture => ({
  kind: "save",
  clientId,
  queuedAt,
  body: { clientId, name, anchor: "pin", lat: 43.05, lng: -124.33 },
  attempts: 0,
});

const PIN = item("cap_pin", "2026-09-25T17:10:04.000Z", "great BLM camp spot");
const NOTE = item("cap_note", "2026-09-25T17:14:00.000Z", "chandel");
const EARLIER = item("cap_early", "2026-09-25T09:00:00.000Z", "Sunny's Smokehouse");

describe("capture queue", () => {
  it("persists under rv.captureQueue.v2 (#113 bumped it: the item has a kind)", () => {
    expect(CAPTURE_QUEUE_KEY).toBe("rv.captureQueue.v2");
    expect(CAPTURE_QUEUE_KEY_V1).toBe("rv.captureQueue.v1");
  });

  it("mints cap_ client ids, distinct within one millisecond", () => {
    const a = newClientId(1_790_000_000_000);
    const b = newClientId(1_790_000_000_000);
    expect(a).toMatch(/^cap_[0-9a-z]+$/);
    expect(a).not.toBe(b);
  });

  it("never queues the same client id twice", () => {
    const q = enqueue(enqueue([], PIN), { ...PIN, queuedAt: "2026-09-25T18:00:00.000Z" });
    expect(q).toEqual([PIN]);
  });

  it("flushes oldest first, whatever order the array is in", () => {
    const q = enqueue(enqueue(enqueue([], NOTE), PIN), EARLIER);
    expect(nextToFlush(q)?.clientId).toBe("cap_early");
    expect(nextToFlush(markSent(q, "cap_early"))?.clientId).toBe("cap_pin");
    expect(nextToFlush([])).toBeNull();
  });

  it("removes an item on 2xx", () => {
    expect(markSent([PIN, NOTE], "cap_pin")).toEqual([NOTE]);
  });

  it("drops an item on 4xx and keeps flushing", () => {
    const out = markFailed([PIN, NOTE], "cap_pin", { status: 400 });
    expect(out).toEqual({ queue: [NOTE], dropped: true, stop: false });
  });

  it("keeps an item on 5xx and on a network error, and stops the flush", () => {
    const five = markFailed([PIN, NOTE], "cap_pin", { status: 503 });
    expect(five.dropped).toBe(false);
    expect(five.stop).toBe(true);
    expect(five.queue.map((q) => q.clientId)).toEqual(["cap_pin", "cap_note"]);
    expect(five.queue[0]!.attempts).toBe(1);

    const net = markFailed(five.queue, "cap_pin", { network: true });
    expect(net.stop).toBe(true);
    expect(net.queue[0]!.attempts).toBe(2);
  });

  it("reads back what it wrote, and an unreadable store as empty", () => {
    expect(parseCaptureQueue(JSON.stringify([PIN, NOTE]))).toEqual([PIN, NOTE]);
    expect(parseCaptureQueue(null)).toEqual([]);
    expect(parseCaptureQueue("{not json")).toEqual([]);
    expect(parseCaptureQueue(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(parseCaptureQueue(JSON.stringify([{ nope: true }, PIN]))).toEqual([PIN]);
  });
});

describe("flushCaptureQueue", () => {
  it("sends oldest first, one at a time, and empties the queue on 2xx", async () => {
    const order: string[] = [];
    const out = await flushCaptureQueue([NOTE, PIN], async (q) => {
      order.push(q.clientId);
      return { status: 201, value: q.kind === "save" ? q.body.name : "" };
    });
    expect(order).toEqual(["cap_pin", "cap_note"]);
    expect(out.queue).toEqual([]);
    expect(out.sent.map((s) => s.value)).toEqual(["great BLM camp spot", "chandel"]);
    expect(out.stopped).toBe(false);
  });

  it("stops at a 5xx with that item and everything after it still queued", async () => {
    const order: string[] = [];
    const out = await flushCaptureQueue([EARLIER, PIN, NOTE], async (q) => {
      order.push(q.clientId);
      return { status: q.clientId === "cap_pin" ? 502 : 201 };
    });
    expect(order).toEqual(["cap_early", "cap_pin"]);
    expect(out.queue.map((q) => q.clientId)).toEqual(["cap_pin", "cap_note"]);
    expect(out.stopped).toBe(true);
  });

  it("keeps everything on a network error", async () => {
    const out = await flushCaptureQueue([PIN, NOTE], async () => {
      throw new TypeError("Network request failed");
    });
    expect(out.queue.map((q) => q.clientId)).toEqual(["cap_pin", "cap_note"]);
    expect(out.stopped).toBe(true);
  });

  it("drops a 4xx and carries on with the rest", async () => {
    const out = await flushCaptureQueue([PIN, NOTE], async (q) => ({
      status: q.clientId === "cap_pin" ? 400 : 200,
    }));
    expect(out.dropped.map((q) => q.clientId)).toEqual(["cap_pin"]);
    expect(out.sent.map((s) => s.item.clientId)).toEqual(["cap_note"]);
    expect(out.queue).toEqual([]);
  });
});

// ── #113 · queue v2: check-offs and "Did it" ride the same rules ─────────────

/** A v1 item exactly as the W1 phone persisted it: no `kind`. */
const V1_ITEM = {
  clientId: "cap_v1",
  queuedAt: "2026-09-25T08:00:00.000Z",
  body: { clientId: "cap_v1", name: "Sunny's Smokehouse", anchor: "pin", lat: 44.05, lng: -121.31 },
  attempts: 2,
};

const PATCH: QueuedPatch = {
  kind: "patch",
  clientId: "cap_patch",
  queuedAt: "2027-01-19T20:41:00.000Z",
  attempts: 0,
  entity: "idea",
  id: "idea_snorkel",
  body: { status: "done", rating: 5, again: true, notes: "Go at low tide from the Westin end." },
};

const DID_IT: QueuedIdea = {
  kind: "idea",
  clientId: "cap_didit",
  queuedAt: "2027-01-19T23:48:00.000Z",
  attempts: 0,
  body: {
    clientId: "cap_didit",
    tripId: "5d3c9d7e-9b8e-4a8e-8f55-5a1f7b6d2c11",
    stopId: "0b6c3b2a-1d4e-4f5a-9b8c-7d6e5f4a3b21",
    title: "Sunset at Playa Flamingo",
    status: "done",
    rating: 5,
    again: true,
  },
};

describe("capture queue v2 (#113)", () => {
  it("loads every v1 item as kind 'save' under the v2 key", () => {
    const migrated = migrateCaptureQueue(null, JSON.stringify([V1_ITEM]));
    expect(migrated).toEqual([{ ...V1_ITEM, kind: "save" }]);
  });

  it("keeps what v2 already holds and adds v1 items once", () => {
    const v2 = JSON.stringify([PATCH, { ...V1_ITEM, kind: "save" }]);
    const migrated = migrateCaptureQueue(v2, JSON.stringify([V1_ITEM, PIN]));
    expect(migrated.map((q) => [q.kind, q.clientId])).toEqual([
      ["patch", "cap_patch"],
      ["save", "cap_v1"],
      ["save", "cap_pin"],
    ]);
  });

  it("round-trips patch and idea items, and skips a malformed patch or a future kind", () => {
    const raw = JSON.stringify([
      PATCH,
      DID_IT,
      { ...PATCH, clientId: "cap_bad", entity: "segment" },
      { ...PATCH, clientId: "cap_future", kind: "photo" },
    ]);
    expect(parseCaptureQueue(raw)).toEqual([PATCH, DID_IT]);
  });

  it("flushes patch and idea items with the shipped 2xx / 4xx / 5xx rules", async () => {
    const q: QueuedItem[] = [DID_IT, PATCH, PIN];
    const seen: string[] = [];
    // PIN (oldest) 201 · PATCH 204 · the idea 5xx → kept, flush stops.
    const first = await flushCaptureQueue(q, async (item) => {
      seen.push(`${item.kind}:${item.clientId}`);
      if (item.kind === "idea") return { status: 503 };
      return { status: item.kind === "patch" ? 204 : 201 };
    });
    expect(seen).toEqual(["save:cap_pin", "patch:cap_patch", "idea:cap_didit"]);
    expect(first.queue).toEqual([{ ...DID_IT, attempts: 1 }]);
    expect(first.stopped).toBe(true);

    // Back in signal: the replayed idea answers 200 (the row exists) → gone.
    const second = await flushCaptureQueue(first.queue, async () => ({ status: 200 }));
    expect(second.queue).toEqual([]);
    expect(second.sent.map((s) => s.item.clientId)).toEqual(["cap_didit"]);

    // A PATCH the server refuses (404: the idea was deleted) is dropped.
    const refused = await flushCaptureQueue([PATCH], async () => ({ status: 404 }));
    expect(refused.dropped.map((d) => d.clientId)).toEqual(["cap_patch"]);
    expect(refused.queue).toEqual([]);
  });
});
