import { expect, it } from "vitest";
import { timelineModel, type Trip } from "@rv-trip/core";
import { db } from "@rv-trip/db";
import { DEV_OWNER, OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { POST as POST_TRIP } from "@/app/api/trips/route";
import { GET as GET_TRIP } from "@/app/api/trips/[id]/route";
import { POST as POST_BOUNDARY } from "@/app/api/trips/[id]/boundary-flights/route";
import { PATCH as PATCH_SEGMENT } from "@/app/api/segments/[id]/route";
import { PATCH as PATCH_RES } from "@/app/api/reservations/[id]/route";
import { GET as GET_PREFS, PUT as PUT_PREFS } from "@/app/api/prefs/route";
import { ctx, describeDb, req } from "@/test/db";

/**
 * Epic #130 · dogfood pass 1, through the REAL handlers — the Bellingham
 * replay: create with an area (#126), the household home base (#126 ·
 * Q5 A), round trip in one save (#129 · Q10 A), the reversible mode switch
 * (#129 · Q11 A) and a hop booking's Edit (#124).
 */

const BELLINGHAM = { googlePlaceId: "ChIJbham", name: "Bellingham, WA", lat: 48.7519, lng: -122.4787 };
const BOISE = { name: "Boise, ID", lat: 43.615, lng: -116.2023, googlePlaceId: "ChIJboise" };

async function createBellingham(extra: Record<string, unknown> = {}) {
  const res = await POST_TRIP(
    req({
      title: "Bellingham Long Weekend",
      area: BELLINGHAM,
      startDate: "2026-10-10",
      endDate: "2026-10-13",
      defaultMode: "fly",
      lodgingDefault: "hotel",
      rigOn: false,
      ...extra,
    }),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as Trip;
}

const bundle = async (id: string) =>
  ((await (await GET_TRIP(req(undefined, "GET"), ctx(id))).json()) as { trip: Trip }).trip;

/** AS 2291 BOI 07:05 MDT → BLI 08:10 PDT, Oct 10; AS 2298 BLI 18:40 PDT → BOI 21:05 MDT, Oct 13. */
const OUTBOUND = {
  name: "AS 2291 BOI→BLI",
  startsAt: "2026-10-10T13:05:00.000Z",
  endsAt: "2026-10-10T15:10:00.000Z",
  startsTz: "America/Boise",
  endsTz: "America/Los_Angeles",
};
const RETURN = {
  name: "AS 2298 BLI→BOI",
  startsAt: "2026-10-14T01:40:00.000Z",
  endsAt: "2026-10-14T03:05:00.000Z",
  startsTz: "America/Los_Angeles",
  endsTz: "America/Boise",
};

describeDb("#126 · create writes the area + one spanning destination", () => {
  it("upserts areas, sets trips.area_id, and one destination equals the trip span", async () => {
    await fx.prefs({ homeBase: "Boise, ID", homeBaseLat: BOISE.lat, homeBaseLng: BOISE.lng });
    const trip = await createBellingham();

    const row = await read.trip(trip.id);
    expect(row!.areaId).not.toBeNull();
    const dest = await db.query.areas.findFirst({
      where: (d, { eq }) => eq(d.id, row!.areaId!),
    });
    expect(dest).toMatchObject({ ownerId: DEV_OWNER, googlePlaceId: "ChIJbham", lat: 48.7519 });

    const destinations = trip.chapters.flatMap((l) => l.destinations);
    expect(destinations).toHaveLength(1);
    expect(destinations[0]).toMatchObject({
      place: { name: "Bellingham, WA", lat: 48.7519, lng: -122.4787, googlePlaceId: "ChIJbham" },
      arriveDate: "2026-10-10",
      departDate: "2026-10-13",
    });
    expect(trip.area).toMatchObject({ name: "Bellingham, WA", lat: 48.7519 });

    // A second trip to the same place REUSES the row.
    const again = await createBellingham({ title: "Bellingham again" });
    expect((await read.trip(again.id))!.areaId).toBe(row!.areaId);
  });

  it("home base not sent → the household's; both boundary hops exist on the fresh trip (vet HIGH ×2)", async () => {
    await fx.prefs({ homeBase: "Boise, ID", homeBaseLat: BOISE.lat, homeBaseLng: BOISE.lng });
    const trip = await createBellingham();
    const destinationId = trip.chapters[0]!.destinations[0]!.id;
    expect(trip.homeBase).toBe("Boise, ID");
    expect(trip.homeBaseFromHousehold).toBe(true);
    expect((await read.segments(trip.id)).map((s) => [s.fromDestinationId, s.toDestinationId, s.mode])).toEqual([
      [null, destinationId, "fly"],
      [destinationId, null, "fly"],
    ]);
    // …which is what paints Oct 10 and Oct 13 as ✈ (#124).
    expect(timelineModel(await bundle(trip.id)).rhythm.map((c) => c.mode ?? c.kind)).toEqual([
      "fly",
      "stay",
      "stay",
      "fly",
    ]);
  });

  it("no home base anywhere → the destination, and no hops invented", async () => {
    const trip = await createBellingham();
    expect(trip.homeBase).toBeNull();
    expect(await read.segments(trip.id)).toHaveLength(0);
  });
});

describeDb("#126 · Q5 A · home base: trip override first, then user_prefs", () => {
  it("PUT /api/prefs takes the household home base (vet MED: .strict()) and GET reads it back", async () => {
    const put = await PUT_PREFS(req({ homeBasePlace: BOISE }, "PUT"));
    expect(put.status).toBe(200);
    expect(await (await GET_PREFS()).json()).toMatchObject({ homeBasePlace: BOISE });
  });

  it("a trip's own override wins; clearing it falls back to the household", async () => {
    await fx.prefs({ homeBase: "Boise, ID", homeBaseLat: BOISE.lat, homeBaseLng: BOISE.lng });
    const own = await createBellingham({ homeBase: "Seattle, WA" });
    expect(await bundle(own.id)).toMatchObject({ homeBase: "Seattle, WA", homeBaseFromHousehold: false });
    const plain = await createBellingham();
    expect(await bundle(plain.id)).toMatchObject({ homeBase: "Boise, ID", homeBaseFromHousehold: true });
  });

  it("setting the household home base later gives a following trip its home → first hop", async () => {
    const trip = await createBellingham();
    expect(await read.segments(trip.id)).toHaveLength(0);
    expect((await PUT_PREFS(req({ homeBasePlace: BOISE }, "PUT"))).status).toBe(200);
    const hops = await read.segments(trip.id);
    expect(hops.map((s) => [s.fromDestinationId, s.toDestinationId])).toEqual([[null, trip.chapters[0]!.destinations[0]!.id]]);
  });
});

describeDb("#129 · Q10 A · round trip in one request", () => {
  it("POST /api/trips/:id/boundary-flights writes BOTH boundary-segment bookings and times both hops", async () => {
    await fx.prefs({ homeBase: "Boise, ID", homeBaseLat: BOISE.lat, homeBaseLng: BOISE.lng });
    const trip = await createBellingham();
    const res = await POST_BOUNDARY(req({ roundTrip: true, outbound: OUTBOUND, return: RETURN }), ctx(trip.id));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Trip;
    const [out, home] = body.segments;
    expect(out).toMatchObject({ fromDestinationId: null, mode: "fly", departAt: OUTBOUND.startsAt });
    expect(out!.reservations.map((r) => r.name)).toEqual(["AS 2291 BOI→BLI"]);
    expect(home).toMatchObject({ toDestinationId: null, mode: "fly", departAt: RETURN.startsAt });
    expect(home!.reservations.map((r) => r.name)).toEqual(["AS 2298 BLI→BOI"]);
  });

  it("creates the → home hop when the trip has none (vet HIGH)", async () => {
    // A trip made WITHOUT an area, its destination added later: reconcile never
    // invents a → home row, so the round trip must.
    const trip = await fx.trip({ homeBase: "Boise, ID", startDate: "2026-10-10", endDate: "2026-10-13", defaultMode: "fly" });
    const chapter = await fx.chapter({ tripId: trip.id });
    const bham = await fx.destination({ chapterId: chapter.id, placeName: "Bellingham, WA", arriveDate: "2026-10-10", departDate: "2026-10-13" });
    await fx.segment({ tripId: trip.id, fromDestinationId: null, toDestinationId: bham.id, mode: "fly" });
    const res = await POST_BOUNDARY(req({ roundTrip: true, outbound: OUTBOUND, return: RETURN }), ctx(trip.id));
    expect(res.status).toBe(201);
    expect((await read.segments(trip.id)).map((s) => [s.fromDestinationId, s.toDestinationId])).toEqual([
      [null, bham.id],
      [bham.id, null],
    ]);
  });

  it("refuses a flight that disagrees with the destination — nothing written; 404 for another owner's trip", async () => {
    await fx.prefs({ homeBase: "Boise, ID", homeBaseLat: BOISE.lat, homeBaseLng: BOISE.lng });
    const trip = await createBellingham();
    const early = { ...RETURN, startsAt: "2026-10-13T01:40:00.000Z", endsAt: "2026-10-13T03:05:00.000Z" };
    const res = await POST_BOUNDARY(req({ roundTrip: true, outbound: OUTBOUND, return: early }), ctx(trip.id));
    expect(res.status).toBe(409);
    expect((await read.segments(trip.id)).every((s) => s.departAt === null)).toBe(true);

    const theirs = await fx.trip({ owner: OTHER_OWNER });
    const other = await POST_BOUNDARY(req({ roundTrip: false, outbound: OUTBOUND }), ctx(theirs.id));
    expect(other.status).toBe(404);
  });
});

describeDb("#129 · Q11 A · PATCH segment keep / remove", () => {
  async function flown() {
    await fx.prefs({ homeBase: "Boise, ID", homeBaseLat: BOISE.lat, homeBaseLng: BOISE.lng });
    const trip = await createBellingham();
    await POST_BOUNDARY(req({ roundTrip: true, outbound: OUTBOUND, return: RETURN }), ctx(trip.id));
    const home = (await read.segments(trip.id)).find((s) => s.toDestinationId === null)!;
    return { trip, home };
  }

  it("mode=drive with bookings=keep succeeds (no 409) and leaves the reservation on the segment", async () => {
    const { home } = await flown();
    const res = await PATCH_SEGMENT(req({ mode: "drive", bookings: "keep" }, "PATCH"), ctx(home.id));
    expect(res.status).toBe(204);
    const [seg] = (await read.segments(home.tripId)).filter((s) => s.id === home.id);
    expect(seg).toMatchObject({ mode: "drive", departAt: null });
    expect((await read.segmentBookings(home.id)).map((r) => r.name)).toEqual(["AS 2298 BLI→BOI"]);
  });

  it("bookings=remove deletes it", async () => {
    const { home } = await flown();
    expect((await PATCH_SEGMENT(req({ mode: "drive", bookings: "remove" }, "PATCH"), ctx(home.id))).status).toBe(204);
    expect(await read.segmentBookings(home.id)).toHaveLength(0);
  });

  it("mode=fly surfaces the kept booking again and re-times the hop from it", async () => {
    const { trip, home } = await flown();
    await PATCH_SEGMENT(req({ mode: "drive", bookings: "keep" }, "PATCH"), ctx(home.id));
    expect((await PATCH_SEGMENT(req({ mode: "fly" }, "PATCH"), ctx(home.id))).status).toBe(204);
    const seg = (await bundle(trip.id)).segments.find((s) => s.id === home.id)!;
    expect(seg).toMatchObject({ mode: "fly", departAt: RETURN.startsAt });
    expect(seg.reservations.map((r) => r.name)).toEqual(["AS 2298 BLI→BOI"]);
  });
});

describeDb("#124 · a hop booking PATCH updates it (vet HIGH: the clock is no longer dropped)", () => {
  it("a PATCHed startsAt lands and re-times its hop", async () => {
    await fx.prefs({ homeBase: "Boise, ID", homeBaseLat: BOISE.lat, homeBaseLng: BOISE.lng });
    const trip = await createBellingham();
    await POST_BOUNDARY(req({ roundTrip: false, outbound: OUTBOUND }), ctx(trip.id));
    const out = (await read.segments(trip.id)).find((s) => s.fromDestinationId === null)!;
    const [booking] = await read.segmentBookings(out.id);
    const later = "2026-10-10T15:05:00.000Z"; // 09:05 MDT
    const res = await PATCH_RES(
      req({ name: "AS 2293 BOI→BLI", startsAt: later, startsTz: "America/Boise", endsAt: "2026-10-10T17:10:00.000Z", endsTz: "America/Los_Angeles" }, "PATCH"),
      ctx(booking!.id),
    );
    expect(res.status).toBe(204);
    expect(await read.reservation(booking!.id)).toMatchObject({ name: "AS 2293 BOI→BLI" });
    expect((await read.reservation(booking!.id))!.startsAt!.toISOString()).toBe(later);
    expect((await read.segments(trip.id)).find((s) => s.id === out.id)!.departAt!.toISOString()).toBe(later);
  });

  it("a clock with no zone is a 400; a clock that misses the destination's day is a 409", async () => {
    await fx.prefs({ homeBase: "Boise, ID", homeBaseLat: BOISE.lat, homeBaseLng: BOISE.lng });
    const trip = await createBellingham();
    await POST_BOUNDARY(req({ roundTrip: false, outbound: OUTBOUND }), ctx(trip.id));
    const out = (await read.segments(trip.id)).find((s) => s.fromDestinationId === null)!;
    const [booking] = await read.segmentBookings(out.id);
    expect((await PATCH_RES(req({ startsAt: "2026-10-10T15:05:00.000Z" }, "PATCH"), ctx(booking!.id))).status).toBe(400);
    const dayLate = await PATCH_RES(
      req({ startsAt: "2026-10-11T13:05:00.000Z", startsTz: "America/Boise", endsAt: "2026-10-11T15:10:00.000Z", endsTz: "America/Los_Angeles" }, "PATCH"),
      ctx(booking!.id),
    );
    expect(dayLate.status).toBe(409);
    expect((await read.reservation(booking!.id))!.startsAt!.toISOString()).toBe(OUTBOUND.startsAt);
  });
});
