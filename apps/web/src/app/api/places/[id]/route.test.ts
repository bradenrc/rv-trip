import { expect, it, vi } from "vitest";
import type { ResolvedArea, SuggestedPlace } from "@rv-trip/core";
import { DEV_OWNER, OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { DELETE, PATCH } from "@/app/api/places/[id]/route";
import { ctx, describeDb, req } from "@/test/db";

/** Pinned to a scripted resolver, like POST's suite: never the laptop's key. */
const resolver = vi.hoisted(() => ({
  calls: [] as [number, number][],
  answer: null as ResolvedArea | null,
}));
vi.mock("@/lib/places", () => ({
  placesProvider: () => ({
    configured: true,
    provider: {
      search: async () => [],
      details: async () => null,
      resolveArea: async (lat: number, lng: number) => {
        resolver.calls.push([lat, lng]);
        return resolver.answer;
      },
    },
  }),
}));

/** §7 breadth. PATCH carries TWO refusals in one handler, and both are asserted. */
describeDb("PATCH/DELETE /api/places/[id]", () => {
  it("404s a PATCH on another owner's place and leaves the note alone", async () => {
    const theirs = await fx.savedPlace({ owner: OTHER_OWNER, name: "Their spot", note: null });

    const res = await PATCH(req({ note: "hijacked" }, "PATCH"), ctx(theirs.id));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "place not found" });
    expect((await read.savedPlace(theirs.id))!.note).toBe(null);
  });

  it("404s a PATCH that re-points an owned place at another owner's trip", async () => {
    const mine = await fx.savedPlace({ name: "My spot" });
    const theirTrip = await fx.trip({ owner: OTHER_OWNER });

    const res = await PATCH(
      req({ status: "been", rating: 5, tripId: theirTrip.id }, "PATCH"),
      ctx(mine.id),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "trip not found" });
    const row = (await read.savedPlace(mine.id))!;
    expect(row.tripId).toBe(null);
    expect(row.status).toBe("want");
    expect(row.rating).toBe(null);
  });

  it("404s a DELETE on another owner's place", async () => {
    const theirs = await fx.savedPlace({ owner: OTHER_OWNER, name: "Their spot" });

    const res = await DELETE(req(undefined, "DELETE"), ctx(theirs.id));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "place not found" });
    expect(await read.savedPlace(theirs.id)).not.toBeNull();
  });
});

// ── #111 i2 · Q3 A: take or dismiss an offline note's suggestion ──────────

const SUGGESTION: SuggestedPlace = {
  name: "El Chandelier",
  googlePlaceId: "ChIJchandelier",
  lat: 43.3665,
  lng: -124.2179,
  subline: "Restaurant · Coos Bay, OR",
};
const COOS_BAY: ResolvedArea = {
  googlePlaceId: "ChIJcoosbay",
  name: "Coos Bay, OR",
  region: "Oregon",
  lat: 43.3665,
  lng: -124.2179,
};

async function chandelNote(owner = DEV_OWNER) {
  const bandon = await fx.area({ owner });
  const note = await fx.savedPlace({
    owner,
    name: "chandel",
    lat: 43.0512,
    lng: -124.329,
    type: "other",
    anchor: "area",
    areaLabel: "Bandon, OR",
    areaId: bandon.id,
    suggestedPlace: SUGGESTION,
  });
  return { bandon, note };
}

describeDb("PATCH /api/places/[id] — the Q3 A suggestion (#111 i2)", () => {
  it("upgradeToSuggested flips area → place, takes the Place ID and point, re-resolves, clears", async () => {
    resolver.calls = [];
    resolver.answer = COOS_BAY;
    const { bandon, note } = await chandelNote();

    const res = await PATCH(req({ upgradeToSuggested: true }, "PATCH"), ctx(note.id));

    expect(res.status).toBe(204);
    const row = (await read.savedPlace(note.id))!;
    expect(row).toMatchObject({
      anchor: "place",
      areaLabel: null,
      name: "El Chandelier",
      googlePlaceId: "ChIJchandelier",
      lat: 43.3665,
      lng: -124.2179,
      suggestedPlace: null,
    });
    // Re-resolved from the PLACE's point, not the capture point.
    expect(resolver.calls).toEqual([[43.3665, -124.2179]]);
    const coos = (await read.areas(DEV_OWNER)).find((d) => d.googlePlaceId === "ChIJcoosbay")!;
    expect(row.areaId).toBe(coos.id);
    expect(row.areaId).not.toBe(bandon.id);
  });

  it("keeps the area it had when the upgrade resolves nothing (no key)", async () => {
    resolver.calls = [];
    resolver.answer = null;
    const { bandon, note } = await chandelNote();
    expect((await PATCH(req({ upgradeToSuggested: true }, "PATCH"), ctx(note.id))).status).toBe(204);
    const row = (await read.savedPlace(note.id))!;
    expect(row.anchor).toBe("place");
    expect(row.areaId).toBe(bandon.id);
  });

  it("suggestedPlace: null (Dismiss) clears the suggestion and nothing else", async () => {
    const { bandon, note } = await chandelNote();
    expect((await PATCH(req({ suggestedPlace: null }, "PATCH"), ctx(note.id))).status).toBe(204);
    const row = (await read.savedPlace(note.id))!;
    expect(row).toMatchObject({
      suggestedPlace: null,
      anchor: "area",
      areaLabel: "Bandon, OR",
      name: "chandel",
      googlePlaceId: null,
      areaId: bandon.id,
    });
  });

  it("an ordinary edit leaves the suggestion standing", async () => {
    const { note } = await chandelNote();
    await PATCH(req({ source: "Marcy" }, "PATCH"), ctx(note.id));
    expect((await read.savedPlace(note.id))!.suggestedPlace).toEqual(SUGGESTION);
  });

  it("409s an upgrade on a save with no suggestion, and writes nothing", async () => {
    const plain = await fx.savedPlace({ name: "Cape Lookout State Park" });
    const res = await PATCH(req({ upgradeToSuggested: true }, "PATCH"), ctx(plain.id));
    expect(res.status).toBe(409);
    expect((await read.savedPlace(plain.id))!.anchor).toBe("area");
  });

  it("404s an upgrade on another owner's save and leaves it alone", async () => {
    const { note } = await chandelNote(OTHER_OWNER);
    const res = await PATCH(req({ upgradeToSuggested: true }, "PATCH"), ctx(note.id));
    expect(res.status).toBe(404);
    expect((await read.savedPlace(note.id))!.suggestedPlace).toEqual(SUGGESTION);
  });

  it("400s a client trying to WRITE a suggestion", async () => {
    const { note } = await chandelNote();
    const res = await PATCH(req({ suggestedPlace: SUGGESTION }, "PATCH"), ctx(note.id));
    expect(res.status).toBe(400);
  });
});
