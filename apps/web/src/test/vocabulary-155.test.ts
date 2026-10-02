import { expect, it } from "vitest";
import { tripBundleSchema } from "@rv-trip/core/api-client";
import { db } from "@rv-trip/db";
import { DEV_OWNER, fx, read } from "@rv-trip/db/testing";
import { POST as POST_TRIP } from "@/app/api/trips/route";
import { GET as GET_TRIP } from "@/app/api/trips/[id]/route";
import { POST as POST_CHAPTER } from "@/app/api/chapters/route";
import { PATCH as PATCH_CHAPTER } from "@/app/api/chapters/[id]/route";
import { POST as POST_RES } from "@/app/api/reservations/route";
import { PATCH as PATCH_RES } from "@/app/api/reservations/[id]/route";
import { ctx, describeDb, req } from "@/test/db";

/**
 * #155 through the REAL handlers: optional chapters (Q1 A) and
 * `reservations.transport_kind` (Q4 A). The rename itself (Q5 B) is exercised
 * by every other suite — they all address /api/destinations and /api/chapters.
 */

async function costaRica(owner = DEV_OWNER) {
  const trip = await fx.trip({
    owner,
    title: "Costa Rica Fly & Stay",
    homeBase: "Boise, ID",
    startDate: "2027-01-16",
    endDate: "2027-01-25",
    defaultMode: "fly",
  });
  const chapter = await fx.chapter({ tripId: trip.id, title: null });
  const conchal = await fx.destination({
    chapterId: chapter.id,
    placeName: "Westin Reserva Conchal",
    arriveDate: "2027-01-16",
    departDate: "2027-01-24",
  });
  const out = await fx.segment({
    tripId: trip.id,
    fromDestinationId: null,
    toDestinationId: conchal.id,
    mode: "fly",
    sortOrder: 0,
  });
  return { trip, chapter, conchal, out };
}

const flight = (segmentId: string) => ({
  segmentId,
  type: "transport",
  name: "AA 2208 LAX→LIR",
  transportKind: "flight",
  startsAt: "2027-01-16T17:40:00.000Z",
  startsTz: "America/Los_Angeles",
  endsAt: "2027-01-16T23:45:00.000Z",
  endsTz: "America/Costa_Rica",
});

describeDb("#155 · Q1 A — a chapter's name is optional", () => {
  it("a new trip opens with ONE unnamed chapter (no more 'Leg 1')", async () => {
    const res = await POST_TRIP(req({ title: "Bend · Portland · Hood River", startDate: "2026-10-01", endDate: "2026-10-08", homeBase: null }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; chapters: { title: string | null }[] };
    expect(body.chapters.map((c) => c.title)).toEqual([null]);
  });

  it("'Add chapter' posts title null and gets an unnamed chapter; a rename names it, null un-names it", async () => {
    const { trip } = await costaRica();
    const res = await POST_CHAPTER(req({ tripId: trip.id, title: null }));
    expect(res.status).toBe(201);
    const made = (await res.json()) as { id: string; title: string | null };
    expect(made.title).toBeNull();
    expect((await read.chapter(made.id))!.title).toBeNull();

    expect((await PATCH_CHAPTER(req({ title: "Oregon Coast" }, "PATCH"), ctx(made.id))).status).toBe(204);
    expect((await read.chapter(made.id))!.title).toBe("Oregon Coast");
    expect((await PATCH_CHAPTER(req({ title: null }, "PATCH"), ctx(made.id))).status).toBe(204);
    expect((await read.chapter(made.id))!.title).toBeNull();
  });

  it("GET /api/trips/:id carries a null title through the read shape", async () => {
    const { trip } = await costaRica();
    const bundle = tripBundleSchema.parse(await (await GET_TRIP(req(undefined, "GET"), ctx(trip.id))).json());
    expect(bundle.trip.chapters.map((c) => c.title)).toEqual([null]);
  });
});

describeDb("#155 · Q4 A — reservations.transport_kind", () => {
  it("POST keeps the kind (vet HIGH: it is on the pick list), and the trip reads it back", async () => {
    const { trip, out } = await costaRica();
    const res = await POST_RES(req({ segmentId: out.id, type: "transport", name: "Airport shuttle · LIR → hotel", transportKind: "shuttle" }));
    expect(res.status).toBe(201);
    const made = (await res.json()) as { id: string; transportKind: string | null };
    expect(made.transportKind).toBe("shuttle");
    expect((await read.reservation(made.id))!.transportKind).toBe("shuttle");

    const bundle = tripBundleSchema.parse(await (await GET_TRIP(req(undefined, "GET"), ctx(trip.id))).json());
    const seg = bundle.trip.segments.find((s) => s.id === out.id)!;
    expect(seg.reservations.map((r) => [r.name, r.transportKind])).toEqual([["Airport shuttle · LIR → hotel", "shuttle"]]);
  });

  it("a timed shuttle never re-times its hop — only the flight does (vet MED)", async () => {
    const { out } = await costaRica();
    expect((await POST_RES(req(flight(out.id)))).status).toBe(201);
    const shuttle = await POST_RES(
      req({
        segmentId: out.id,
        type: "transport",
        name: "Airport shuttle · LIR → hotel",
        transportKind: "shuttle",
        startsAt: "2027-01-17T00:15:00.000Z",
        startsTz: "America/Costa_Rica",
        endsAt: "2027-01-17T01:30:00.000Z",
        endsTz: "America/Costa_Rica",
      }),
    );
    expect(shuttle.status).toBe(201);
    const [seg] = (await read.segments(out.tripId)).filter((s) => s.id === out.id);
    expect(seg!.departAt?.toISOString()).toBe("2027-01-16T17:40:00.000Z");
    expect(seg!.arriveAt?.toISOString()).toBe("2027-01-16T23:45:00.000Z");
  });

  it("a shuttle timed on a day the destination disagrees with is NOT a date clash", async () => {
    const { out } = await costaRica();
    // Lands Jan 19 local — a flight there would be 409 segment_date_mismatch.
    const res = await POST_RES(
      req({
        segmentId: out.id,
        type: "transport",
        name: "Airport shuttle",
        transportKind: "shuttle",
        startsAt: "2027-01-19T15:00:00.000Z",
        startsTz: "America/Costa_Rica",
        endsAt: "2027-01-19T16:00:00.000Z",
        endsTz: "America/Costa_Rica",
      }),
    );
    expect(res.status).toBe(201);
  });

  it("PATCH writes the kind, and a booking with none stays null", async () => {
    const { out } = await costaRica();
    const made = (await (await POST_RES(req({ ...flight(out.id), transportKind: undefined }))).json()) as { id: string };
    expect((await read.reservation(made.id))!.transportKind).toBeNull();
    expect((await PATCH_RES(req({ transportKind: "train" }, "PATCH"), ctx(made.id))).status).toBe(204);
    expect((await read.reservation(made.id))!.transportKind).toBe("train");
    const rows = await db.query.reservations.findMany({ where: (r, { eq }) => eq(r.segmentId, out.id) });
    expect(rows).toHaveLength(1);
  });

  it("400s a kind outside the five", async () => {
    const { out } = await costaRica();
    expect((await POST_RES(req({ ...flight(out.id), transportKind: "bus" }))).status).toBe(400);
  });
});
