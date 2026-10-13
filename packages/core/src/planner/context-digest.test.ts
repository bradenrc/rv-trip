import { describe, expect, it } from "vitest";
import type { SavedPlace } from "../domain/types";
import { pnwTrip, seedAreas, seedSaves, seedTrips } from "../seeds/index";
import { CONTEXT_MORE, contextDigest, contextDigestResponse } from "./context-digest";
import { forNextTime } from "./for-next-time";
import { nearbySaves } from "./nearby-saves";

/**
 * #162 · Q1 B — `get_context`'s digest on the seeded Pacific Northwest Loop
 * (Boise, Aug 1–28): Astoria + Newport on the coast, Bend + floating Crater
 * Lake in the mountains, four untimed drives.
 */

function seededLibrary(): SavedPlace[] {
  const dests = new Map(seedAreas().map((d) => [d.key, d]));
  return seedSaves().map((s, i) => {
    const d = s.area ? dests.get(s.area)! : null;
    return {
      id: `sv_${i}`,
      ownerId: "dev-household",
      place: { name: s.name, lat: s.lat, lng: s.lng, googlePlaceId: null },
      region: s.region,
      type: s.type,
      status: s.status,
      note: s.note,
      source: s.source,
      rating: s.rating,
      again: s.again,
      tripId: s.trip,
      tripName: null,
      lastChange: null,
      anchor: s.anchor,
      areaLabel: s.areaLabel,
      area: d
        ? { id: `dst_${d.key}`, name: d.name, region: d.region, googlePlaceId: d.googlePlaceId, lat: d.lat, lng: d.lng }
        : null,
      suggestedPlace: s.suggestedPlace,
      createdAt: s.createdAt,
    };
  });
}

function digest() {
  const trip = pnwTrip();
  const lib = seededLibrary();
  const nt = forNextTime(trip, seedTrips(), lib);
  return contextDigest(trip, nearbySaves(trip, lib, [], null, nt.saveIds), nt);
}

describe("contextDigest (#162 · Q1 B)", () => {
  it("parses as its own response schema", () => {
    expect(contextDigestResponse.safeParse(digest()).success).toBe(true);
  });

  it("heads with the trip's identity, defaults and coalesced home base", () => {
    expect(digest().trip).toEqual({
      id: "trip_pnw",
      title: "Pacific Northwest Loop",
      dates: ["2026-08-01", "2026-08-28"],
      status: "planning",
      defaults: { mode: "drive", rig: true },
      homeBase: "Boise, ID",
    });
  });

  it("lists the route in chapter then sort order — MM-DD dates, counts, a stay name, rating only when set", () => {
    expect(digest().route).toEqual([
      { id: "stp_astoria", name: "Astoria, OR", dates: ["08-02", "08-05"], stay: "Astoria/Warrenton KOA", ideas: 0, bookings: 2, rating: 5 },
      { id: "stp_newport", name: "Newport, OR", dates: ["08-05", "08-09"], stay: "South Beach State Park", ideas: 2, bookings: 1, rating: 4 },
      { id: "stp_bend", name: "Bend, OR", dates: ["08-12", "08-16"], stay: null, ideas: 1, bookings: 0 },
      { id: "stp_crater", name: "Crater Lake NP", floating: true, stay: null, ideas: 1, bookings: 0 },
    ]);
  });

  it("names a home end of a hop as the literal 'home', and says whether it has a clock", () => {
    const hops = digest().hops;
    expect(hops[0]).toMatchObject({ from: "home", to: "stp_astoria", mode: "drive", timed: false });
    expect(hops.map((h) => `${h.from}>${h.to}`)).toEqual([
      "home>stp_astoria",
      "stp_astoria>stp_newport",
      "stp_newport>stp_bend",
      "stp_bend>stp_crater",
    ]);
  });

  it("reports the open-day runs from deriveDays and the scheduled destinations with no stay", () => {
    const { gaps } = digest();
    // Aug 1 is open (the untimed home → Astoria drive borrows Aug 2), then the
    // Newport → Bend gap, then everything after Bend.
    expect(gaps.open).toEqual(["08-01..08-01", "08-10..08-11", "08-17..08-28"]);
    // Crater Lake is floating, so it is never "missing a stay".
    expect(gaps.noStay).toEqual(["stp_bend"]);
  });

  it("flattens the nearby saves — nearest destination by id, one-decimal miles, source only when present", () => {
    const { nearby } = digest();
    expect(nearby.length).toBeGreaterThan(0);
    for (const n of nearby) {
      expect(["stp_astoria", "stp_newport", "stp_bend"]).toContain(n.near);
      expect(Math.round(n.mi * 10) / 10).toBe(n.mi);
      if ("source" in n) expect(n.source).toBeTruthy();
    }
  });

  it("keys 'Last time here' by its nearest destination id, with ★n on rated rows", () => {
    const { lastTime } = digest();
    expect(lastTime).toHaveLength(1);
    expect(lastTime[0]!.near).toBe("stp_newport");
    expect(lastTime[0]!.trip).toBe("Oregon Coast Weekend");
    expect(lastTime[0]!.again.some((s) => /★\d$/.test(s))).toBe(true);
  });

  it("carries no note or booking bodies — the drill-down is get_trip", () => {
    const d = digest();
    expect(d.more).toBe(CONTEXT_MORE);
    const text = JSON.stringify(d);
    expect(text).not.toContain("Loved the riverwalk");
    expect(text).not.toContain("KOA-88213");
  });
});
