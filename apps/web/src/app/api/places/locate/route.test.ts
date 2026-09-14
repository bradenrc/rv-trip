import { expect, it } from "vitest";
import { locatePlaces, type PlaceSummary, type PlacesProvider } from "@rv-trip/core";
import { dbLocateStore } from "@rv-trip/db";
import { DEV_OWNER, OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { POST } from "@/app/api/places/locate/route";
import { describeDb, req } from "@/test/db";

/**
 * POST /api/places/locate, the third kind (#69).
 *
 * The decision tree itself is covered in core (places-locate.test.ts) against a
 * fake store. What can ONLY be covered here is the store: `dbLocateStore` is
 * the owner-scoped seam, and the guarantee that matters is that a foreign
 * idea's id loads nothing — so it is never geocoded, never billed and never
 * written. The route above it is a thin adapter; its 400 is asserted once.
 */

const FOREIGN_UUID = "99999999-9999-4999-8999-999999999999";

/** Answers one canned summary for any query. Serial, so the order the batch
 * asked in is the order this records. */
class FakeProvider implements PlacesProvider {
  readonly asked: string[] = [];
  constructor(private readonly answer: PlaceSummary | null) {}
  async search(query: string): Promise<PlaceSummary[]> {
    this.asked.push(query);
    return this.answer ? [this.answer] : [];
  }
  async details(): Promise<PlaceSummary | null> {
    return null;
  }
}

const FALLS: PlaceSummary = {
  googlePlaceId: "ChIJtumalo",
  name: "Tumalo Falls Trailhead",
  location: { lat: 44.0317, lng: -121.5678 },
  rating: 4.8,
  address: "Tumalo Falls Rd, Bend, OR 97703",
};

describeDb("POST /api/places/locate — ideas", () => {
  it("400s a body whose kind is not one of the three", async () => {
    const res = await POST(req({ rows: [{ kind: "reservation", id: FOREIGN_UUID }] }));
    expect(res.status).toBe(400);
  });

  it("loads a coordless idea by id, under the owner's scope", async () => {
    const { astoria } = await fx.pacificNorthwestLoop();
    const idea = await fx.idea({ stopId: astoria.id, title: "Tumalo Falls trailhead" });

    const targets = await dbLocateStore(DEV_OWNER).load([{ kind: "idea", id: idea.id }]);

    // The search text is the idea's TITLE — it has no place name until
    // something locates it — and it borrows no region from the trip.
    expect(targets).toEqual([
      { kind: "idea", id: idea.id, name: "Tumalo Falls trailhead", region: null },
    ]);
  });

  it("loads NOTHING for another owner's idea — the one that actually matters", async () => {
    const { idea } = await fx.pacificNorthwestLoop(OTHER_OWNER);
    const provider = new FakeProvider(FALLS);

    const answer = await locatePlaces({
      rows: [{ kind: "idea", id: idea.id }],
      provider,
      store: dbLocateStore(DEV_OWNER),
    });

    // Never loaded ⇒ never asked ⇒ never written. The row is simply still
    // unmapped, exactly as an unknown id would be.
    expect(await dbLocateStore(DEV_OWNER).load([{ kind: "idea", id: idea.id }])).toEqual([]);
    expect(provider.asked).toEqual([]);
    expect(answer).toEqual({ located: 0, stillUnmapped: 1, results: [] });
    const row = (await read.idea(idea.id))!;
    expect(row.lat).toBeNull();
    expect(row.lng).toBeNull();
  });

  it("loads nothing for an idea that already has a pin — no re-bill, no moving it", async () => {
    const { astoria } = await fx.pacificNorthwestLoop();
    const idea = await fx.idea({ stopId: astoria.id, lat: 44.0317, lng: -121.5678 });

    expect(await dbLocateStore(DEV_OWNER).load([{ kind: "idea", id: idea.id }])).toEqual([]);
  });

  it("writes the pin onto the idea, and FILLS an empty place_name with Google's", async () => {
    const { astoria } = await fx.pacificNorthwestLoop();
    const idea = await fx.idea({ stopId: astoria.id, title: "Tumalo Falls trailhead" });

    const answer = await locatePlaces({
      rows: [{ kind: "idea", id: idea.id }],
      provider: new FakeProvider(FALLS),
      store: dbLocateStore(DEV_OWNER),
    });

    expect(answer.located).toBe(1);
    const row = (await read.idea(idea.id))!;
    expect(row.lat).toBe(44.0317);
    expect(row.lng).toBe(-121.5678);
    expect(row.googlePlaceId).toBe("ChIJtumalo");
    // place_name is required, not optional: `mapIdea` keys the whole nested
    // `place` off that column, so coordinates without a name would be invisible.
    expect(row.placeName).toBe("Tumalo Falls Trailhead");
  });

  it("KEEPS a place name the human typed — a batch press never renames their row", async () => {
    const { astoria } = await fx.pacificNorthwestLoop();
    // The picker's free-text escape row: a name, no coordinates.
    const idea = await fx.idea({
      stopId: astoria.id,
      title: "waterfall hike",
      placeName: "Tumalo Falls, the upper lot",
    });

    await locatePlaces({
      rows: [{ kind: "idea", id: idea.id }],
      provider: new FakeProvider(FALLS),
      store: dbLocateStore(DEV_OWNER),
    });

    const row = (await read.idea(idea.id))!;
    expect(row.lat).toBe(44.0317);
    expect(row.placeName).toBe("Tumalo Falls, the upper lot");
  });

  it("asks Google about the idea's title — a row's name never comes from the client", async () => {
    const { astoria } = await fx.pacificNorthwestLoop();
    const idea = await fx.idea({ stopId: astoria.id, title: "Deschutes River float" });
    const provider = new FakeProvider(null);

    await locatePlaces({
      rows: [{ kind: "idea", id: idea.id }],
      provider,
      store: dbLocateStore(DEV_OWNER),
    });

    expect(provider.asked).toEqual(["Deschutes River float"]);
    // An activity is not a place: no answer carries a location, so the row
    // stays unmapped rather than being pinned somewhere plausible.
    expect((await read.idea(idea.id))!.lat).toBeNull();
  });

  it("spans all three kinds in one batch", async () => {
    const { astoria, trip } = await fx.pacificNorthwestLoop();
    const stop = await fx.stop({ legId: astoria.legId, lat: null, lng: null, sortOrder: 9 });
    const idea = await fx.idea({ stopId: astoria.id });
    const place = await fx.savedPlace({ lat: null, lng: null, tripId: trip.id });

    const targets = await dbLocateStore(DEV_OWNER).load([
      { kind: "stop", id: stop.id },
      { kind: "place", id: place.id },
      { kind: "idea", id: idea.id },
    ]);

    expect(targets.map((t) => t.kind).sort()).toEqual(["idea", "place", "stop"]);
  });
});
