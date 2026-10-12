import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiKey, db, getTripById, schema } from "@rv-trip/db";
import { DEV_OWNER, fx, read } from "@rv-trip/db/testing";
import { describeDb } from "@/test/db";
import { call, connect, household, text } from "@/test/mcp";

/**
 * #162 — the trip grammar as MCP tools, each through the real SDK client
 * (`connect`, test/mcp.ts) against the real route handler and database.
 *
 * The Places provider is a switch the tests flip: keyless by default (the
 * stub every walk and CI run has), a fake Google for Q5 B's resolve-and-pin,
 * and one that throws (vet MED: an upstream failure falls back like keyless).
 */
const places = vi.hoisted(() => ({
  mode: "keyless" as "keyless" | "hit" | "throws" | "miss",
  searched: [] as { query: string; near: unknown }[],
}));
vi.mock("@/lib/places", () => ({
  areaResolver: () => async () => null,
  placesProvider: () => {
    if (places.mode === "keyless") return { configured: false, provider: { search: async () => [] } };
    return {
      configured: true,
      provider: {
        search: async (query: string, near: unknown) => {
          places.searched.push({ query, near });
          if (places.mode === "throws") throw new Error("google 503");
          if (places.mode === "miss") return [];
          const name = query.split(",")[0]!;
          return [{ googlePlaceId: `gp_${name.toLowerCase()}`, name, location: { lat: 48.99, lng: -122.75 }, rating: null, address: null }];
        },
      },
    };
  },
}));

const LA = "America/Los_Angeles";
const SEATTLE = { lat: 47.6062, lng: -122.3321 };

beforeEach(() => {
  places.mode = "keyless";
  places.searched = [];
});

/** Every change_log row, as the tests read it. */
const logRows = () => db.select().from(schema.changeLog);

/**
 * The Bellingham paste (docs/design/162 §3), call by call — the acceptance.
 * Returns the ids the walk would read off the Itinerary.
 */
async function bellingham(client: Awaited<ReturnType<typeof connect>>) {
  const trip = await call(client, "create_trip", {
    title: "Bellingham",
    startDate: "2026-11-11",
    endDate: "2026-11-15",
    defaultMode: "fly",
    lodgingDefault: "hotel",
    rigOn: false,
  });
  const sea = await call(client, "add_destination", {
    tripId: trip.tripId,
    place: "Seattle, WA",
    arriveDate: "2026-11-11",
    departDate: "2026-11-12",
  });
  const bla = await call(client, "add_destination", {
    tripId: trip.tripId,
    place: "Blaine, WA",
    arriveDate: "2026-11-12",
    departDate: "2026-11-15",
  });
  const drive = await call(client, "add_segment", {
    tripId: trip.tripId,
    from: sea.destination.id,
    to: bla.destination.id,
    mode: "drive",
  });
  const home = await call(client, "add_segment", { tripId: trip.tripId, from: bla.destination.id, to: "home", mode: "fly" });
  const hyatt = await call(client, "add_reservation", {
    destinationId: sea.destination.id,
    type: "lodging",
    lodgingKind: "hotel",
    name: "Hyatt Place Seattle/Downtown",
    checkIn: "2026-11-11",
    checkOut: "2026-11-12",
    startsAt: "2026-11-11T16:00:00-08:00",
    startsTz: LA,
    endsAt: "2026-11-12T11:00:00-08:00",
    endsTz: LA,
    notes: "Two rooms",
  });
  const airbnb = await call(client, "add_reservation", {
    destinationId: bla.destination.id,
    type: "lodging",
    lodgingKind: "airbnb",
    name: "Airbnb · 5057 Anderson Rd",
    checkIn: "2026-11-12",
    checkOut: "2026-11-15",
    startsAt: "2026-11-12T15:00:00-08:00",
    startsTz: LA,
    endsAt: "2026-11-15T11:00:00-08:00",
    endsTz: LA,
  });
  const full = (await getTripById(DEV_OWNER, trip.tripId))!;
  const inbound = full.segments.find((s) => s.fromDestinationId === null)!;
  const sixt = await call(client, "add_reservation", {
    segmentId: inbound.id,
    type: "transport",
    transportKind: "car",
    name: "Sixt rental · SeaTac Rental Car Facility",
    startsAt: "2026-11-11T17:30:00-08:00",
    startsTz: LA,
    checkOut: "2026-11-15",
    notes: "Return at SeaTac",
  });
  const eats = [];
  for (const [i, title] of ["Drayton Harbor Oyster Co.", "Blaine Harbor Fish", "The Vault Wine Bar"].entries()) {
    eats.push(
      await call(client, "add_idea", {
        tripId: trip.tripId,
        destinationId: bla.destination.id,
        title,
        category: "eat",
        notes: "why it made the cut",
        sourceUrl: "https://example.com/eat",
        clientId: `eat_${i}`,
      }),
    );
  }
  return { trip, sea, bla, drive, home, hyatt, airbnb, sixt, eats };
}

describeDb("MCP grammar (#162) — the Bellingham acceptance", () => {
  it("lands the paste as a trip: two fly boundary hops, a drive between, both stays with their clocks, three eat ideas", async () => {
    await fx.prefs({ homeBase: "Boise, ID", homeBaseLat: 43.615, homeBaseLng: -116.2023 });
    const client = await connect();
    const r = await bellingham(client);

    expect(r.trip).toMatchObject({ homeBase: "Boise, ID", replayed: false });
    expect(r.trip.chapterId).toEqual(expect.any(String));
    expect(r.drive).toMatchObject({ mode: "drive", born: false });
    expect(r.home).toMatchObject({ mode: "fly", born: true, to: "home" });

    const trip = (await getTripById(DEV_OWNER, r.trip.tripId))!;
    const dests = trip.chapters[0]!.destinations;
    // Keyless: the names as typed, unmapped — the row's coordless warning shows.
    expect(dests.map((d) => d.place)).toEqual([
      { name: "Seattle, WA", lat: null, lng: null, googlePlaceId: null },
      { name: "Blaine, WA", lat: null, lng: null, googlePlaceId: null },
    ]);
    expect(r.sea.resolved).toBeNull();
    // Hops: home → Seattle (fly, the trip default), Seattle → Blaine (drive), Blaine → home (fly, born).
    const hops = [...trip.segments].sort((a, b) => a.sortOrder - b.sortOrder);
    expect(hops.map((s) => [s.fromDestinationId, s.toDestinationId, s.mode])).toEqual([
      [null, dests[0]!.id, "fly"],
      [dests[0]!.id, dests[1]!.id, "drive"],
      [dests[1]!.id, null, "fly"],
    ]);
    // The car never moves the hop's clock (countsTowardClock).
    expect(hops[0]!.departAt).toBeNull();
    expect(hops[0]!.reservations.map((x) => x.name)).toEqual(["Sixt rental · SeaTac Rental Car Facility"]);
    // Stays carry their clock (Q3 A) on the same fields a flight uses.
    expect(dests[0]!.reservations[0]).toMatchObject({
      name: "Hyatt Place Seattle/Downtown",
      lodgingKind: "hotel",
      startsAt: "2026-11-12T00:00:00.000Z",
      endsAt: "2026-11-12T19:00:00.000Z",
      startsTz: LA,
    });
    // The research picks are maybes — they land on the Ideas tab, under Blaine.
    expect(dests[1]!.ideas.map((i) => [i.title, i.status])).toEqual([
      ["Drayton Harbor Oyster Co.", "idea"],
      ["Blaine Harbor Fish", "idea"],
      ["The Vault Wine Bar", "idea"],
    ]);
    expect(dests[1]!.ideas[0]!.notes).toBe("why it made the cut\n\nSource: https://example.com/eat");
  });

  it("names the adder on every new thing (Q2 A) — one `created` row each, by the key's minter", async () => {
    await fx.prefs({ homeBase: "Boise, ID" });
    await household(DEV_OWNER, "user_braden");
    const { key } = await createApiKey(DEV_OWNER, { name: "k", createdBy: "user_braden" });
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_dummy";
    process.env.CLERK_SECRET_KEY = "sk_test_dummy";
    try {
      const r = await bellingham(await connect(key));
      const rows = await logRows();
      // 2 destinations + 3 reservations + 3 ideas. Trips and hops are not loggable.
      expect(rows.filter((x) => x.field === "created")).toHaveLength(8);
      expect(new Set(rows.map((x) => x.memberId))).toEqual(new Set(["user_braden"]));
      const hyattRow = rows.find((x) => x.entityId === r.hyatt.reservation.id)!;
      expect(hyattRow).toMatchObject({ entity: "reservation", field: "created", from: null, to: "Hyatt Place Seattle/Downtown" });

      // …and the trip payload carries it as the byline every row reads.
      const trip = (await getTripById(DEV_OWNER, r.trip.tripId))!;
      const sea = trip.chapters[0]!.destinations[0]!;
      expect(sea.lastChange).toMatchObject({ field: "created", memberName: "user_braden" });
      expect(sea.reservations[0]!.lastChange).toMatchObject({ field: "created" });
      expect(trip.segments.find((s) => s.fromDestinationId === null)!.reservations[0]!.lastChange).toMatchObject({
        field: "created",
      });
    } finally {
      delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
      delete process.env.CLERK_SECRET_KEY;
    }
  });

  it("re-running the whole paste duplicates nothing and logs nothing new (Q4 C)", async () => {
    await fx.prefs({ homeBase: "Boise, ID" });
    const client = await connect();
    const first = await bellingham(client);
    const before = {
      trips: (await db.select().from(schema.trips)).length,
      dests: (await db.select().from(schema.destinations)).length,
      res: (await db.select().from(schema.reservations)).length,
      ideas: (await db.select().from(schema.ideas)).length,
      segs: (await db.select().from(schema.travelSegments)).length,
      log: (await logRows()).length,
    };
    const again = await bellingham(client);
    expect(again.trip).toMatchObject({ tripId: first.trip.tripId, replayed: true });
    expect(again.sea).toMatchObject({ replayed: true, destination: { id: first.sea.destination.id } });
    expect(again.hyatt).toMatchObject({ replayed: true, reservation: { id: first.hyatt.reservation.id } });
    expect(again.sixt).toMatchObject({ replayed: true, reservation: { id: first.sixt.reservation.id } });
    expect(again.home).toMatchObject({ born: false, segmentId: first.home.segmentId });
    expect(again.eats.every((e: { replayed: boolean }) => e.replayed)).toBe(true);
    expect({
      trips: (await db.select().from(schema.trips)).length,
      dests: (await db.select().from(schema.destinations)).length,
      res: (await db.select().from(schema.reservations)).length,
      ideas: (await db.select().from(schema.ideas)).length,
      segs: (await db.select().from(schema.travelSegments)).length,
      log: (await logRows()).length,
    }).toEqual(before);
  });

  it("replays a destination on its typed name, trimmed and case-insensitive, whatever the Places hit was called", async () => {
    places.mode = "hit";
    const client = await connect();
    const trip = await call(client, "create_trip", { title: "Bellingham", startDate: "2026-11-11", endDate: "2026-11-15" });
    const a = await call(client, "add_destination", { tripId: trip.tripId, place: "Seattle, WA" });
    // Q5 B: the pin comes from the top hit and the hit is echoed; the NAME
    // stays the one typed, so the card reads "Seattle, WA" and a re-paste matches.
    expect(a.resolved).toEqual({ name: "Seattle", googlePlaceId: "gp_seattle" });
    expect(a.destination.place).toEqual({ name: "Seattle, WA", lat: 48.99, lng: -122.75, googlePlaceId: "gp_seattle" });
    const b = await call(client, "add_destination", { tripId: trip.tripId, place: "  seattle, wa " });
    expect(b).toMatchObject({ replayed: true, destination: { id: a.destination.id } });
    expect((await db.select().from(schema.destinations)).length).toBe(1);
  });
});

describeDb("MCP grammar (#162) — each tool's edges", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;
  });

  describe("create_trip", () => {
    it("never writes a destination, and refuses dates that run backwards", async () => {
      const client = await connect();
      const t = await call(client, "create_trip", { title: "Empty", startDate: "2026-11-11", endDate: "2026-11-15" });
      expect(t.homeBase).toBeNull();
      expect(await read.countDestinations(t.chapterId)).toBe(0);
      const bad = await client.callTool({ name: "create_trip", arguments: { title: "x", startDate: "2026-11-15", endDate: "2026-11-11" } });
      expect(bad.isError).toBe(true);
      expect(text(bad)).toMatch(/before startDate/);
    });
  });

  describe("add_destination", () => {
    it("biases the search near the previous located destination, else the home base", async () => {
      places.mode = "hit";
      const loop = await fx.pacificNorthwestLoop();
      const client = await connect();
      await call(client, "add_destination", { tripId: loop.trip.id, place: "Ashland, OR" });
      expect(places.searched[0]!.near).toEqual({ lat: loop.bend.lat, lng: loop.bend.lng });

      const empty = await call(client, "create_trip", { title: "Fresh", startDate: "2026-11-11", endDate: "2026-11-15" });
      await fx.prefs({ homeBase: "Seattle, WA", homeBaseLat: SEATTLE.lat, homeBaseLng: SEATTLE.lng });
      await call(client, "add_destination", { tripId: empty.tripId, place: "Blaine, WA" });
      expect(places.searched[1]!.near).toEqual(SEATTLE);
    });

    it("falls back to the name as typed when the search throws or finds nothing", async () => {
      const client = await connect();
      const t = await call(client, "create_trip", { title: "T", startDate: "2026-11-11", endDate: "2026-11-15" });
      places.mode = "throws";
      const a = await call(client, "add_destination", { tripId: t.tripId, place: "Blaine, WA" });
      expect(a).toMatchObject({ resolved: null, destination: { place: { name: "Blaine, WA", lat: null, googlePlaceId: null } } });
      places.mode = "miss";
      const b = await call(client, "add_destination", { tripId: t.tripId, place: "Nowhere" });
      expect(b.resolved).toBeNull();
    });

    it("stores an object place as given, with no lookup", async () => {
      places.mode = "hit";
      const client = await connect();
      const t = await call(client, "create_trip", { title: "T", startDate: "2026-11-11", endDate: "2026-11-15" });
      const p = { name: "Birch Bay", lat: 48.92, lng: -122.75, googlePlaceId: "gp_birch" };
      const a = await call(client, "add_destination", { tripId: t.tripId, place: p });
      expect(a.destination.place).toEqual(p);
      expect(places.searched).toEqual([]);
    });

    it("refuses half a date range, a chapter from another trip, and a foreign trip", async () => {
      const loop = await fx.pacificNorthwestLoop();
      const client = await connect();
      const t = await call(client, "create_trip", { title: "T", startDate: "2026-11-11", endDate: "2026-11-15" });
      const half = await client.callTool({ name: "add_destination", arguments: { tripId: t.tripId, place: "X", arriveDate: "2026-11-11" } });
      expect(text(half)).toMatch(/go together/);
      const wrong = await client.callTool({
        name: "add_destination",
        arguments: { tripId: t.tripId, place: "X", chapterId: loop.chapterCoast.id },
      });
      expect(text(wrong)).toMatch(/chapter not found/);
      const foreign = await fx.trip({ owner: "other-user" });
      const theirs = await client.callTool({ name: "add_destination", arguments: { tripId: foreign.id, place: "X" } });
      expect(text(theirs)).toMatch(/trip not found/);
    });
  });

  describe("add_segment", () => {
    it("names the two ends when they are not adjacent", async () => {
      const loop = await fx.pacificNorthwestLoop();
      const client = await connect();
      const r = await client.callTool({
        name: "add_segment",
        arguments: { tripId: loop.trip.id, from: loop.astoria.id, to: loop.bend.id, mode: "fly" },
      });
      expect(r.isError).toBe(true);
      expect(text(r)).toMatch(/"Astoria, OR" → "Bend, OR" are not adjacent/);
    });

    it("refuses the hop home on a trip with no home base, writing nothing", async () => {
      const client = await connect();
      const t = await call(client, "create_trip", { title: "T", startDate: "2026-11-11", endDate: "2026-11-15" });
      const d = await call(client, "add_destination", { tripId: t.tripId, place: "Blaine, WA", arriveDate: "2026-11-11", departDate: "2026-11-15" });
      const r = await client.callTool({ name: "add_segment", arguments: { tripId: t.tripId, from: d.destination.id, to: "home", mode: "fly" } });
      expect(r.isError).toBe(true);
      expect(text(r)).toMatch(/no home base/);
      expect(await read.segments(t.tripId)).toEqual([]);
    });
  });

  describe("add_reservation", () => {
    it("runs the create contract's refine — one parent, a clock needs its zone", async () => {
      const loop = await fx.pacificNorthwestLoop();
      const client = await connect();
      const both = await client.callTool({
        name: "add_reservation",
        arguments: { destinationId: loop.astoria.id, segmentId: loop.astoria.id, type: "lodging", name: "X" },
      });
      expect(text(both)).toMatch(/exactly one of destinationId \/ segmentId/);
      const zoneless = await client.callTool({
        name: "add_reservation",
        arguments: { destinationId: loop.astoria.id, type: "lodging", name: "X", startsAt: "2026-08-02T15:00:00-07:00" },
      });
      expect(text(zoneless)).toMatch(/startsAt needs its zone/);
      expect(await read.countReservations(loop.astoria.id)).toBe(1);
    });

    it("answers a destination-date clash readably, writing nothing (the REST 409)", async () => {
      await fx.prefs({ homeBase: "Boise, ID" });
      const client = await connect();
      const t = await call(client, "create_trip", { title: "T", startDate: "2026-11-11", endDate: "2026-11-15", defaultMode: "fly" });
      await call(client, "add_destination", { tripId: t.tripId, place: "Seattle, WA", arriveDate: "2026-11-11", departDate: "2026-11-15" });
      const inbound = (await read.segments(t.tripId)).find((s) => s.fromDestinationId === null)!;
      const r = await client.callTool({
        name: "add_reservation",
        arguments: {
          segmentId: inbound.id,
          type: "transport",
          transportKind: "flight",
          name: "AS 2291",
          startsAt: "2026-11-13T08:00:00-08:00",
          startsTz: LA,
          endsAt: "2026-11-13T10:00:00-08:00",
          endsTz: LA,
        },
      });
      expect(r.isError).toBe(true);
      expect(text(r)).toMatch(/segment_date_mismatch: .*2026-11-13.*2026-11-11/);
      expect(await read.segmentBookings(inbound.id)).toEqual([]);
    });
  });

  describe("add_save", () => {
    it("saves to the library with a created row, and replays on clientId", async () => {
      const client = await connect();
      const a = await call(client, "add_save", { anchor: "area", areaLabel: "Blaine, WA", name: "Semiahmoo Spit", type: "activity", clientId: "s1" });
      expect(a).toMatchObject({ replayed: false, saved: { place: { name: "Semiahmoo Spit" }, anchor: "area", areaLabel: "Blaine, WA" } });
      const b = await call(client, "add_save", { anchor: "area", areaLabel: "Blaine, WA", name: "Semiahmoo Spit", type: "activity", clientId: "s1" });
      expect(b).toMatchObject({ replayed: true, saved: { id: a.saved.id } });
      expect((await logRows()).filter((x) => x.entity === "save" && x.field === "created")).toHaveLength(1);
    });

    it("refuses an anchor without what anchors it", async () => {
      const client = await connect();
      expect(text(await client.callTool({ name: "add_save", arguments: { anchor: "pin", name: "X", type: "other" } }))).toMatch(/pin needs lat and lng/);
      expect(text(await client.callTool({ name: "add_save", arguments: { anchor: "area", name: "X", type: "other" } }))).toMatch(/areaLabel/);
      expect(await read.countSavedPlaces(DEV_OWNER)).toBe(0);
    });
  });

  describe("journal_entry (Q7 B)", () => {
    it("patches an idea done + rated, through the shipped log", async () => {
      const loop = await fx.pacificNorthwestLoop();
      const client = await connect();
      const idea = await call(client, "journal_entry", { target: { kind: "idea", id: loop.idea.id }, status: "done", rating: 5, again: true });
      expect(idea).toMatchObject({ id: loop.idea.id, status: "done", rating: 5, again: true, lastChange: { memberName: "dev-user" } });
      expect((await logRows()).filter((x) => x.entityId === loop.idea.id).map((x) => x.field).sort()).toEqual(["again", "rating", "status"]);
    });

    it("rates a destination, and refuses status on anything but an idea", async () => {
      const loop = await fx.pacificNorthwestLoop();
      const client = await connect();
      const r = await client.callTool({ name: "journal_entry", arguments: { target: { kind: "destination", id: loop.astoria.id }, status: "done" } });
      expect(r.isError).toBe(true);
      expect(text(r)).toMatch(/status applies to ideas only/);
      const d = await call(client, "journal_entry", { target: { kind: "destination", id: loop.astoria.id }, rating: 4, notes: "windy" });
      expect(d).toMatchObject({ id: loop.astoria.id, rating: 4, notes: "windy" });
      const res = await call(client, "journal_entry", { target: { kind: "reservation", id: loop.reservation.id }, again: false });
      expect(res).toMatchObject({ id: loop.reservation.id, again: false });
    });

    it("says not found for a foreign or missing id", async () => {
      const client = await connect();
      const missing = "7f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
      for (const kind of ["idea", "destination", "reservation"]) {
        const r = await client.callTool({ name: "journal_entry", arguments: { target: { kind, id: missing }, rating: 3 } });
        expect(text(r)).toBe(`${kind} not found`);
      }
    });

    it("creates a never-planned thing as a done idea, with its created row, replaying on clientId", async () => {
      const loop = await fx.pacificNorthwestLoop();
      const client = await connect();
      const args = {
        target: { tripId: loop.trip.id, destinationId: loop.bend.id, title: "Sunny's Smokehouse", category: "eat" },
        rating: 5,
        again: true,
        clientId: "j1",
      };
      const a = await call(client, "journal_entry", args);
      expect(a).toMatchObject({ replayed: false, idea: { title: "Sunny's Smokehouse", status: "done", rating: 5, again: true } });
      const b = await call(client, "journal_entry", args);
      expect(b).toMatchObject({ replayed: true, idea: { id: a.idea.id } });
      expect((await logRows()).filter((x) => x.entityId === a.idea.id).map((x) => x.field)).toEqual(["created"]);
    });
  });

  describe("get_context (Q1 B)", () => {
    it("is the digest of the trip — every id, the gaps, no bodies", async () => {
      const loop = await fx.pacificNorthwestLoop();
      const client = await connect();
      const ctx = await call(client, "get_context", { tripId: loop.trip.id });
      expect(ctx.trip).toMatchObject({ id: loop.trip.id, title: "Pacific Northwest Loop", dates: ["2026-08-01", "2026-08-28"] });
      expect(ctx.route.map((d: { id: string }) => d.id)).toEqual(expect.arrayContaining([loop.astoria.id, loop.newport.id, loop.bend.id]));
      // The fixture writes no hop rows; the projection's hop rules are core's test.
      expect(ctx.hops).toEqual(expect.any(Array));
      expect(ctx.gaps).toEqual({ open: expect.any(Array), noStay: expect.any(Array) });
      expect(ctx.more).toMatch(/get_trip/);
    });
  });
});
