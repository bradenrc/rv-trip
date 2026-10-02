import { describe, expect, it } from "vitest";
import { costaRicaTrip, pnwTrip } from "../seeds/index";
import { timelineModel, routeModel } from "../planner/index";
import {
  placesSearchQuerySchema,
  searchPlacesEnvelope,
  OwnerTokenBucket,
} from "../providers/places-search";
import type { LatLng, PlaceSummary, PlacesProvider } from "../providers/index";
import { buildSearchBody } from "../providers/google-places";
import { deriveDays } from "./derive-days";
import { BLANK_TRIP_DRAFT, tripDraftInput, withTripMode } from "./trip-form";
import { searchAnchor, searchAnchorChip } from "./search-anchor";
import { resolveHomeBase, userPrefsPatch } from "./prefs";
import {
  dayCellState,
  monthGrid,
  pickDay,
  rangePickState,
  stepNights,
  widenedSpan,
  nightsLabel,
  spanLabel,
} from "./date-range";
import {
  boundaryFlightsBody,
  boundarySegments,
  hopDraftFromBooking,
  hopBookingPatch,
  mirrorReturnDraft,
  withReturnHop,
} from "./boundary-flights";
import { editSegmentBooking, parkedBookings, setSegmentMode, type HopBookingDraft } from "./hops";
import {
  boundaryFlightsInput,
  reservationPatchInput,
  segmentPatchInput,
  tripCreateInput,
  type Place,
  type Segment,
  type Destination,
  type Trip,
} from "./types";

const place = (name: string, lat: number | null = null, lng: number | null = null): Place => ({
  name,
  lat,
  lng,
  googlePlaceId: null,
});

const BELLINGHAM = { name: "Bellingham, WA", googlePlaceId: "ChIJbham", lat: 48.7519, lng: -122.4787 };
const BOISE = place("Boise, ID", 43.615, -116.2023);

function destination(id: string, p: Place, arriveDate: string | null = null, departDate: string | null = null): Destination {
  return {
    id,
    chapterId: "chapter1",
    place: p,
    arriveDate,
    departDate,
    sortOrder: 0,
    rating: null,
    again: null,
    notes: null,
    reservations: [],
    ideas: [],
    lastChange: null,
  };
}

function seg(p: Partial<Segment> & { id: string }): Segment {
  return {
    tripId: "t",
    fromDestinationId: null,
    toDestinationId: null,
    mode: "drive",
    departAt: null,
    arriveAt: null,
    departTz: null,
    arriveTz: null,
    sortOrder: 0,
    reservations: [],
    ...p,
  };
}

function bham(destinations: Destination[], extra: Partial<Trip> = {}): Trip {
  return {
    ...costaRicaTrip(),
    id: "t",
    title: "Bellingham Long Weekend",
    homeBase: "Boise, ID",
    homeBasePlace: BOISE,
    area: { id: "d1", ...BELLINGHAM },
    startDate: "2026-10-10",
    endDate: "2026-10-13",
    defaultMode: "fly",
    chapters: [{ id: "chapter1", tripId: "t", title: "Chapter 1", sortOrder: 0, destinations }],
    segments: [],
    ideas: [],
    ...extra,
  };
}

// ── #126 · the trip grammar carries an area ─────────────────────────
describe("#126 · tripCreateInput carries the area (vet MED: .pick() is closed)", () => {
  it("keeps area with its coordinates", () => {
    const parsed = tripCreateInput.parse({
      title: "Bellingham Long Weekend",
      startDate: "2026-10-10",
      endDate: "2026-10-13",
      defaultMode: "fly",
      area: BELLINGHAM,
    });
    expect(parsed.area).toEqual(BELLINGHAM);
    expect(parsed.homeBase).toBeNull();
  });
  it("an older client with no area still parses", () => {
    expect(
      tripCreateInput.parse({ title: "x", startDate: "2026-10-10", endDate: "2026-10-13" }).area,
    ).toBeUndefined();
  });
});

// ── #126 · Q5 A · home base: trip override first, then the household ───────
describe("#126 · resolveHomeBase", () => {
  it("the trip's own override wins", () => {
    const r = resolveHomeBase({ homeBase: "Seattle, WA", homeBasePlace: place("Seattle, WA", 47.6, -122.3) }, BOISE);
    expect(r).toEqual({ homeBase: "Seattle, WA", homeBasePlace: place("Seattle, WA", 47.6, -122.3), fromHousehold: false });
  });
  it("no override → the household default, flagged", () => {
    expect(resolveHomeBase({ homeBase: null, homeBasePlace: null }, BOISE)).toEqual({
      homeBase: "Boise, ID",
      homeBasePlace: BOISE,
      fromHousehold: true,
    });
  });
  it("neither → nothing", () => {
    expect(resolveHomeBase({ homeBase: null, homeBasePlace: null }, null)).toEqual({
      homeBase: null,
      homeBasePlace: null,
      fromHousehold: false,
    });
  });
  it("PUT /api/prefs accepts the household home base (vet MED: the patch is .strict())", () => {
    expect(userPrefsPatch.safeParse({ homeBasePlace: BOISE }).success).toBe(true);
    expect(userPrefsPatch.safeParse({ homeBasePlace: null }).success).toBe(true);
    expect(userPrefsPatch.safeParse({ homeBase: "Boise" }).success).toBe(false);
  });
});

// ── #126 · the anchor order: destination → area → located destination → null ─────
describe("#126 · searchAnchor", () => {
  const coast = destination("s1", place("Fairhaven", 48.72, -122.5), "2026-10-10", "2026-10-11");
  const bare = destination("s2", place("Somewhere"));
  const last = destination("s3", place("Lummi Island", 48.7, -122.67), "2026-10-12", "2026-10-13");

  it("a destination's own add-stay search is anchored to the destination", () => {
    const a = searchAnchor(bham([coast]), { kind: "destination", destinationId: "s1" });
    expect(a).toMatchObject({ name: "Fairhaven", source: "destination" });
    expect(searchAnchorChip(a)).toBe("near Fairhaven — this destination");
  });
  it("then the trip's area", () => {
    const a = searchAnchor(bham([bare]), { kind: "destination", destinationId: "s2" });
    expect(a).toMatchObject({ name: "Bellingham, WA", lat: 48.7519, source: "area" });
    expect(searchAnchorChip(a)).toBe("near Bellingham, WA — from this trip");
  });
  it("then a located destination (first for the trip, last for ideas)", () => {
    const t = bham([coast, bare, last], { area: null });
    expect(searchAnchor(t, { kind: "trip" })).toMatchObject({ name: "Fairhaven", source: "trip" });
    expect(searchAnchor(t, { kind: "ideas" })).toMatchObject({ name: "Lummi Island", source: "trip" });
  });
  it("then null — NEVER the home base (it anchors a drive, not a search)", () => {
    const t = bham([bare], { area: null, homeBasePlace: BOISE });
    expect(searchAnchor(t, { kind: "trip" })).toBeNull();
    expect(searchAnchor(t, { kind: "after", destinationId: null })).toBeNull();
    expect(searchAnchorChip(null)).toBe("Search near…?");
  });
  it("a new destination leans on the destination above it, then the area", () => {
    expect(searchAnchor(bham([coast]), { kind: "after", destinationId: "s1" })).toMatchObject({ name: "Fairhaven" });
    expect(searchAnchor(bham([coast]), { kind: "after", destinationId: null })).toMatchObject({
      name: "Bellingham, WA",
    });
  });
});

// ── #127 · the RangePicker's arithmetic ─────────────────────────────────────
describe("#127 · RangePicker", () => {
  const trip = { start: "2026-10-10", end: "2026-10-13" };
  it("the whole trip: 3 nights, no guard", () => {
    expect(rangePickState(trip, trip)).toEqual({ nights: 3, outsideDays: 0, extendTo: null, wholeTrip: true });
  });
  it("Q7 B · a pick outside the span goes amber and offers the widened span", () => {
    const pick = { start: "2026-10-11", end: "2026-10-14" };
    const s = rangePickState(pick, trip);
    expect(s.outsideDays).toBe(1);
    expect(s.extendTo).toEqual({ start: "2026-10-10", end: "2026-10-14" });
    expect(spanLabel(s.extendTo!)).toBe("Oct 10 – 14");
    expect(dayCellState("2026-10-14", pick, trip)).toMatchObject({ picked: true, edge: true, outside: true });
    expect(dayCellState("2026-10-12", pick, trip)).toMatchObject({ picked: true, outside: false, inTrip: true });
    expect(widenedSpan({ start: "2026-10-08", end: "2026-10-09" }, trip)).toEqual({
      start: "2026-10-08",
      end: "2026-10-13",
    });
  });
  it("no tripSpan (trip creation) → no band and no guard", () => {
    const s = rangePickState({ start: "2026-10-10", end: "2026-10-13" }, null);
    expect(s).toMatchObject({ outsideDays: 0, extendTo: null, wholeTrip: false });
  });
  it("two taps make a forward range; a tap before the start swaps", () => {
    const one = pickDay({ start: null, end: null }, "2026-10-12");
    expect(one).toEqual({ start: "2026-10-12", end: null });
    expect(pickDay(one, "2026-10-10")).toEqual({ start: "2026-10-10", end: "2026-10-12" });
    expect(pickDay({ start: "2026-10-10", end: "2026-10-12" }, "2026-10-20")).toEqual({
      start: "2026-10-20",
      end: null,
    });
  });
  it("October 2026 starts on a Thursday, Sunday-first", () => {
    const g = monthGrid("2026-10");
    expect(g[0]).toEqual([null, null, null, null, "2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(g.every((w) => w.length === 7)).toBe(true);
  });
  it("the stay stepper moves check-out and never crosses check-in", () => {
    expect(stepNights(trip, 1)).toEqual({ start: "2026-10-10", end: "2026-10-14" });
    expect(stepNights({ start: "2026-10-10", end: "2026-10-10" }, -1)).toEqual({
      start: "2026-10-10",
      end: "2026-10-10",
    });
    expect(nightsLabel(1)).toBe("1 night");
  });
});

// ── #128 · Q9 A · lodging-typed search ──────────────────────────────────────
describe("#128 · places search accepts type=lodging", () => {
  it("the schema takes it, and refuses anything else", () => {
    const parsed = placesSearchQuerySchema.safeParse({ q: "hol", near: "48.7519,-122.4787", type: "lodging" });
    expect(parsed.success && parsed.data.type).toBe("lodging");
    expect(placesSearchQuerySchema.safeParse({ q: "hol", type: "restaurant" }).success).toBe(false);
  });
  it("the envelope hands the type to the provider; Google sends includedType", async () => {
    const asked: { near?: LatLng; type?: string }[] = [];
    const provider: PlacesProvider = {
      async search(_q: string, near?: LatLng, type?: "lodging") {
        asked.push({ near, type });
        return [] as PlaceSummary[];
      },
      async details() {
        return null;
      },
      async resolveArea() {
        return null;
      },
    };
    await searchPlacesEnvelope({
      provider,
      configured: true,
      owner: "o",
      query: "hol",
      type: "lodging",
      limiter: new OwnerTokenBucket(),
    });
    expect(asked[0]!.type).toBe("lodging");
    expect(buildSearchBody("hol", undefined, "lodging")).toMatchObject({ includedType: "lodging" });
    expect(buildSearchBody("hol")).not.toHaveProperty("includedType");
  });
});

// ── #129 · round trip + reversible mode ─────────────────────────────────────
const OUT: HopBookingDraft = {
  kind: "flight",
  label: "AS 2291",
  from: "BOI",
  to: "BLI",
  departs: "2026-10-10 07:05",
  arrives: "2026-10-10 08:10",
  fromZone: null,
  toZone: null,
};

describe("#129 · round trip", () => {
  it("the return mirrors the airports and dates to the trip's last day", () => {
    const back = mirrorReturnDraft(OUT, "2026-10-13");
    expect(back).toMatchObject({ from: "BLI", to: "BOI", label: "", departs: "2026-10-13 " });
  });
  it("one body, both flights — and null until the return is filled", () => {
    const back = { ...mirrorReturnDraft(OUT, "2026-10-13"), label: "AS 2298" };
    expect(boundaryFlightsBody(true, OUT, back)).toBeNull();
    const filled = { ...back, departs: "2026-10-13 18:40", arrives: "2026-10-13 21:05" };
    const body = boundaryFlightsBody(true, OUT, filled)!;
    expect(body.outbound).toMatchObject({ name: "AS 2291 BOI→BLI", startsTz: "America/Boise" });
    expect(body.return).toMatchObject({ name: "AS 2298 BLI→BOI", startsTz: "America/Los_Angeles" });
    expect(boundaryFlightsInput.safeParse(body).success).toBe(true);
    expect(boundaryFlightsBody(false, OUT, null)).toMatchObject({ roundTrip: false, return: null });
  });
  it("the schema refuses a round trip with no return", () => {
    const body = boundaryFlightsBody(false, OUT, null)!;
    expect(boundaryFlightsInput.safeParse({ ...body, roundTrip: true }).success).toBe(false);
  });
  it("withReturnHop births the → home hop exactly once (vet HIGH)", () => {
    const t = bham([destination("s1", place("Bellingham, WA", 48.75, -122.48), "2026-10-10", "2026-10-13")], {
      segments: [seg({ id: "out", toDestinationId: "s1", mode: "fly" })],
    });
    let n = 0;
    const once = withReturnHop(t, () => `new${n++}`);
    expect(boundarySegments(once).return).toMatchObject({ id: "new0", fromDestinationId: "s1", toDestinationId: null, mode: "fly" });
    expect(withReturnHop(once, () => "again").segments).toHaveLength(2);
  });
});

describe("#129 · Q11 A · keep or remove on Fly → Drive", () => {
  const flight = { ...costaRicaTrip().segments[0]!.reservations[0]! };
  const t = bham([destination("s1", BOISE, "2026-10-10", "2026-10-13")], {
    segments: [
      seg({
        id: "home",
        fromDestinationId: "s1",
        mode: "fly",
        departAt: flight.startsAt,
        arriveAt: flight.endsAt,
        departTz: flight.startsTz,
        arriveTz: flight.endsTz,
        reservations: [{ ...flight, segmentId: "home" }],
      }),
    ],
  });

  it("keep parks the booking on the hop and clears its clock", () => {
    const d = setSegmentMode(t, "home", "drive", "keep");
    expect(d.segments[0]).toMatchObject({ mode: "drive", departAt: null });
    expect(d.segments[0]!.reservations).toHaveLength(1);
    expect(parkedBookings(d.segments[0]!)).toBe(1);
  });
  it("remove drops it", () => {
    expect(setSegmentMode(t, "home", "drive", "remove").segments[0]!.reservations).toHaveLength(0);
  });
  it("Fly brings the kept booking back AND re-times the hop from it (vet MED 2)", () => {
    const back = setSegmentMode(setSegmentMode(t, "home", "drive", "keep"), "home", "fly");
    expect(back.segments[0]).toMatchObject({ mode: "fly", departAt: new Date(flight.startsAt!).toISOString() });
  });
  it("the Route draws a parked hop with its count, never its flight rows", () => {
    const parked = setSegmentMode(t, "home", "drive", "keep");
    const [chapter] = routeModel(parked);
    expect(chapter!.returnHop).toMatchObject({ mode: "drive", parked: 1, items: [] });
  });
  it("segmentPatchInput carries the choice; absent reads as keep at the server", () => {
    expect(segmentPatchInput.parse({ mode: "drive", bookings: "keep" })).toEqual({ mode: "drive", bookings: "keep" });
    expect(segmentPatchInput.safeParse({ mode: "drive", bookings: "shred" }).success).toBe(false);
  });
});

// ── #124 · boundary fly days + hop booking edit ────────────────────────────
describe("#124 · boundary fly/ferry hops own their days", () => {
  it("Costa Rica seed: Jan 16 and Jan 25 are ✈ on the timeline model", () => {
    const m = timelineModel(costaRicaTrip());
    expect(m.rhythm[0]).toMatchObject({ kind: "travel", mode: "fly" });
    expect(m.rhythm.at(-1)).toMatchObject({ kind: "travel", mode: "fly" });
    expect(m.rhythm[1]).toMatchObject({ kind: "stay" });
  });
  it("a boundary fly hop wins its day over an untimed drive that borrows the same date", () => {
    const a = destination("a", place("A"), "2026-10-10", "2026-10-10");
    const b = destination("b", place("B"), "2026-10-10", "2026-10-13");
    const segments = [
      seg({ id: "out", toDestinationId: "a", mode: "fly", sortOrder: 0 }),
      seg({ id: "ab", fromDestinationId: "a", toDestinationId: "b", mode: "drive", sortOrder: 1 }),
    ];
    const { days } = deriveDays({ startDate: "2026-10-10", endDate: "2026-10-13" }, [a, b], segments);
    expect(days[0]).toMatchObject({ kind: "travel", mode: "fly", segmentId: "out" });
  });
  it("a fresh Bellingham trip with both boundary hops paints Oct 10 and Oct 13 as ✈", () => {
    const s1 = destination("s1", place("Bellingham, WA", 48.75, -122.48), "2026-10-10", "2026-10-13");
    const t = bham([s1], {
      segments: [seg({ id: "out", toDestinationId: "s1", mode: "fly" }), seg({ id: "home", fromDestinationId: "s1", mode: "fly", sortOrder: 1 })],
    });
    expect(timelineModel(t).rhythm.map((c) => c.mode ?? c.kind)).toEqual(["fly", "stay", "stay", "fly"]);
  });

  it("Edit seeds the form from the stored booking, and the patch carries the new clock", () => {
    const r = costaRicaTrip().segments[0]!.reservations[0]!; // AA 2451 BOI→LAX
    const d = hopDraftFromBooking(r, "flight");
    expect(d).toMatchObject({ label: "AA 2451", from: "BOI", to: "LAX", fromZone: "America/Boise" });
    expect(d.departs).toBe("2027-01-16 06:05");
    const later = "2027-01-16T14:05:00.000Z";
    const patch = hopBookingPatch(r, { ...r, startsAt: later });
    expect(patch).toEqual({ startsAt: later, startsTz: "America/Boise" });
    expect(reservationPatchInput.safeParse(patch).success).toBe(true);
    expect(reservationPatchInput.safeParse({ startsAt: later }).success).toBe(false);
  });
  it("an edited booking re-times its hop", () => {
    const cr = costaRicaTrip();
    const r = cr.segments[0]!.reservations[0]!;
    const next = editSegmentBooking(cr, r.id, { startsAt: "2027-01-16T12:05:00.000Z" });
    expect(next.segments[0]!.departAt).toBe("2027-01-16T12:05:00.000Z");
  });
});

// ── #131 · Itinerary lists knowns only ─────────────────────────────────────
describe("#131 · Route rows show planned/done ideas only", () => {
  it("status idea stays off the Route", () => {
    const t = pnwTrip();
    const rows = routeModel(t).flatMap((l) => l.rows);
    const all = t.chapters.flatMap((l) => l.destinations).flatMap((s) => s.ideas);
    const shown = rows.flatMap((r) => r.ideas);
    expect(shown.every((i) => i.status !== "idea")).toBe(true);
    expect(shown.length).toBe(all.filter((i) => i.status !== "idea").length);
  });
});

// ── #126 · the create form's "Where to?" ────────────────────────────────────
describe("#126 · tripDraftInput carries the area", () => {
  const picked = { ...BELLINGHAM, address: null, rating: null, primaryType: null };
  const base = { ...withTripMode(BLANK_TRIP_DRAFT, "air"), startDate: "2026-10-10", endDate: "2026-10-13" };
  it("a Google place becomes the area, and names an untitled trip", () => {
    expect(tripDraftInput({ ...base, area: picked })).toMatchObject({
      title: "Bellingham, WA",
      area: BELLINGHAM,
      homeBase: null,
    });
  });
  it("a free-text pick names the trip but is no area", () => {
    const body = tripDraftInput({ ...base, area: { ...picked, googlePlaceId: null } });
    expect(body?.title).toBe("Bellingham, WA");
    expect(body).not.toHaveProperty("area");
  });
});
