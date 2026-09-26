import { describe, it, expect } from "vitest";
import {
  CAPTURE_QUEUE_KEY,
  enqueue,
  flushCaptureQueue,
  markFailed,
  markSent,
  newClientId,
  nextToFlush,
  parseCaptureQueue,
  type QueuedCapture,
} from "./queue";

// docs/design/111 #100 offline: oldest first, one at a time; 2xx removes,
// 4xx drops, 5xx / network keeps the item and stops the flush.

const item = (clientId: string, queuedAt: string, name = clientId): QueuedCapture => ({
  clientId,
  queuedAt,
  body: { clientId, name, anchor: "pin", lat: 43.05, lng: -124.33 },
  attempts: 0,
});

const PIN = item("cap_pin", "2026-09-25T17:10:04.000Z", "great BLM camp spot");
const NOTE = item("cap_note", "2026-09-25T17:14:00.000Z", "chandel");
const EARLIER = item("cap_early", "2026-09-25T09:00:00.000Z", "Sunny's Smokehouse");

describe("capture queue", () => {
  it("persists under rv.captureQueue.v1", () => {
    expect(CAPTURE_QUEUE_KEY).toBe("rv.captureQueue.v1");
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
      return { status: 201, value: q.body.name };
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
