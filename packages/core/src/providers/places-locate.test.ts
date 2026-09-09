import { describe, expect, it } from "vitest";
import type { LatLng, PlaceSummary, PlacesProvider } from "./index";
import { StubPlacesProvider } from "./index";
import {
  LOCATE_MAX_ROWS,
  dedupeLocateRows,
  locatePlaces,
  locateQuery,
  locateRequestSchema,
  locateToastMessage,
  type LocateRow,
  type LocateStore,
  type LocateTarget,
} from "./places-locate";

/**
 * Locate — docs/design/41 §6, the bounded backfill.
 *
 * Same split as places-search.ts: every decision lives here, where a runner
 * actually runs, and `api/places/locate/route.ts` is the adapter that reads the
 * body, builds the db-backed store and hands back the answer. The ops script
 * (`pnpm backfill:places`) calls this same function with the same store.
 */

const KOA_ID = "11111111-1111-4111-8111-111111111111";
const PULLOUT_ID = "22222222-2222-4222-8222-222222222222";
const FOREIGN_ID = "33333333-3333-4333-8333-333333333333";

const KOA: PlaceSummary = {
  googlePlaceId: "ChIJkoa",
  name: "Astoria/Warrenton KOA",
  location: { lat: 46.1712, lng: -123.9012 },
  rating: 4.3,
  address: "1100 Ridge Rd, Hammond, OR 97121",
};

/** A row whose only Google answer carries no coordinates at all. */
const COORDLESS_ANSWER: PlaceSummary = {
  googlePlaceId: "ChIJnowhere",
  name: "Forest Road 25 pullout",
  location: null,
  rating: null,
  address: null,
};

const target = (row: LocateRow, name: string, region: string | null = null): LocateTarget => ({
  ...row,
  name,
  region,
});

const koaRow: LocateRow = { kind: "place", id: KOA_ID };
const pulloutRow: LocateRow = { kind: "stop", id: PULLOUT_ID };

/** Answers per query, and records everything it was asked. */
class FakeProvider implements PlacesProvider {
  readonly searches: string[] = [];
  constructor(private readonly byQuery: Record<string, PlaceSummary[]> = {}) {}
  async search(query: string): Promise<PlaceSummary[]> {
    this.searches.push(query);
    return this.byQuery[query] ?? [];
  }
  async details(): Promise<PlaceSummary | null> {
    return null;
  }
}

class BrokenProvider implements PlacesProvider {
  async search(): Promise<PlaceSummary[]> {
    throw new Error("Google places:searchText → 500");
  }
  async details(): Promise<PlaceSummary | null> {
    return null;
  }
}

/** In-memory stand-in for the drizzle store: only the targets it holds exist,
 * exactly as the real query only returns rows this owner owns. */
class FakeStore implements LocateStore {
  readonly writes: { id: string; coords: LatLng; googlePlaceId: string | null }[] = [];
  constructor(
    private readonly targets: LocateTarget[],
    private readonly writable = true,
  ) {}
  async load(rows: LocateRow[]): Promise<LocateTarget[]> {
    return this.targets.filter((t) => rows.some((r) => r.kind === t.kind && r.id === t.id));
  }
  async saveCoords(t: LocateTarget, found: PlaceSummary): Promise<boolean> {
    if (!this.writable) return false;
    this.writes.push({
      id: t.id,
      coords: found.location!,
      googlePlaceId: found.googlePlaceId,
    });
    return true;
  }
}

// ── the request body ───────────────────────────────────────────────────────
describe("locateRequestSchema", () => {
  it("takes a batch of ids with their kind", () => {
    const parsed = locateRequestSchema.safeParse({ rows: [koaRow, pulloutRow] });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.rows).toEqual([koaRow, pulloutRow]);
  });

  it("caps the batch at 25 rows", () => {
    expect(LOCATE_MAX_ROWS).toBe(25);
    const rows = Array.from({ length: LOCATE_MAX_ROWS }, () => koaRow);
    expect(locateRequestSchema.safeParse({ rows }).success).toBe(true);
    expect(locateRequestSchema.safeParse({ rows: [...rows, koaRow] }).success).toBe(false);
  });

  it("rejects an empty batch", () => {
    expect(locateRequestSchema.safeParse({ rows: [] }).success).toBe(false);
  });

  it("rejects an unknown kind and a non-uuid id", () => {
    expect(locateRequestSchema.safeParse({ rows: [{ kind: "idea", id: KOA_ID }] }).success).toBe(
      false,
    );
    expect(locateRequestSchema.safeParse({ rows: [{ kind: "stop", id: "nope" }] }).success).toBe(
      false,
    );
  });

  it("never accepts a name from the client — an extra key is dropped, not kept", () => {
    const parsed = locateRequestSchema.safeParse({
      rows: [{ ...koaRow, name: "Somewhere I do not own" }],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.rows[0]).toEqual(koaRow);
  });
});

// ── the geocode query ──────────────────────────────────────────────────────
describe("locateQuery", () => {
  it("joins the name and the region the database holds", () => {
    expect(locateQuery({ name: "Astoria/Warrenton KOA", region: "Astoria, OR" })).toBe(
      "Astoria/Warrenton KOA, Astoria, OR",
    );
  });

  it("is the bare name when the row has no region — a stop has no region column", () => {
    expect(locateQuery({ name: "Forest Road 25 pullout", region: null })).toBe(
      "Forest Road 25 pullout",
    );
  });
});

describe("dedupeLocateRows", () => {
  it("keeps first-seen order and never bills the same row twice", () => {
    expect(dedupeLocateRows([koaRow, pulloutRow, koaRow])).toEqual([koaRow, pulloutRow]);
  });

  it("treats the same id on two kinds as two rows", () => {
    const asStop: LocateRow = { kind: "stop", id: KOA_ID };
    expect(dedupeLocateRows([koaRow, asStop])).toEqual([koaRow, asStop]);
  });
});

// ── the batch ──────────────────────────────────────────────────────────────
describe("locatePlaces", () => {
  it("geocodes a row and writes the coordinates back", async () => {
    const provider = new FakeProvider({ "Astoria/Warrenton KOA, Astoria, OR": [KOA] });
    const store = new FakeStore([target(koaRow, "Astoria/Warrenton KOA", "Astoria, OR")]);

    const out = await locatePlaces({ rows: [koaRow], provider, store });

    expect(out).toEqual({
      located: 1,
      stillUnmapped: 0,
      results: [{ id: KOA_ID, lat: 46.1712, lng: -123.9012 }],
    });
    expect(store.writes).toEqual([
      { id: KOA_ID, coords: { lat: 46.1712, lng: -123.9012 }, googlePlaceId: "ChIJkoa" },
    ]);
  });

  it("searches the name the DATABASE holds, never one the caller sent", async () => {
    const provider = new FakeProvider({ "Astoria/Warrenton KOA": [KOA] });
    const store = new FakeStore([target(koaRow, "Astoria/Warrenton KOA")]);

    // The request row carries an id and a kind and nothing else; the query the
    // provider sees is built from the loaded row.
    await locatePlaces({ rows: [koaRow], provider, store });

    expect(provider.searches).toEqual(["Astoria/Warrenton KOA"]);
  });

  it("reports a partial batch: one located, one Google cannot place", async () => {
    const provider = new FakeProvider({
      "Astoria/Warrenton KOA": [KOA],
      "Forest Road 25 pullout": [],
    });
    const store = new FakeStore([
      target(koaRow, "Astoria/Warrenton KOA"),
      target(pulloutRow, "Forest Road 25 pullout"),
    ]);

    const out = await locatePlaces({ rows: [koaRow, pulloutRow], provider, store });

    expect(out.located).toBe(1);
    expect(out.stillUnmapped).toBe(1);
    expect(out.results).toEqual([{ id: KOA_ID, lat: 46.1712, lng: -123.9012 }]);
    // The row that could not be placed was never written.
    expect(store.writes.map((w) => w.id)).toEqual([KOA_ID]);
  });

  it("counts a row whose only answer is coordless as still unmapped", async () => {
    const provider = new FakeProvider({ "Forest Road 25 pullout": [COORDLESS_ANSWER] });
    const store = new FakeStore([target(pulloutRow, "Forest Road 25 pullout")]);

    const out = await locatePlaces({ rows: [pulloutRow], provider, store });

    expect(out).toEqual({ located: 0, stillUnmapped: 1, results: [] });
    expect(store.writes).toEqual([]);
  });

  it("takes the first answer that carries a location, not the first answer", async () => {
    const provider = new FakeProvider({ "Astoria/Warrenton KOA": [COORDLESS_ANSWER, KOA] });
    const store = new FakeStore([target(koaRow, "Astoria/Warrenton KOA")]);

    const out = await locatePlaces({ rows: [koaRow], provider, store });

    expect(out.results).toEqual([{ id: KOA_ID, lat: 46.1712, lng: -123.9012 }]);
  });

  it("returns a row the store does not own as still unmapped, and never asks Google about it", async () => {
    const provider = new FakeProvider({ "Astoria/Warrenton KOA": [KOA] });
    const store = new FakeStore([target(koaRow, "Astoria/Warrenton KOA")]);
    const foreign: LocateRow = { kind: "place", id: FOREIGN_ID };

    const out = await locatePlaces({ rows: [koaRow, foreign], provider, store });

    expect(out.located).toBe(1);
    expect(out.stillUnmapped).toBe(1);
    expect(provider.searches).toEqual(["Astoria/Warrenton KOA"]);
  });

  it("does not throw when the provider does — the row is still unmapped and the batch finishes", async () => {
    const store = new FakeStore([
      target(koaRow, "Astoria/Warrenton KOA"),
      target(pulloutRow, "Forest Road 25 pullout"),
    ]);

    const out = await locatePlaces({ rows: [koaRow, pulloutRow], provider: new BrokenProvider(), store });

    expect(out).toEqual({ located: 0, stillUnmapped: 2, results: [] });
  });

  it("locates nothing with no key configured — StubPlacesProvider answers empty", async () => {
    const store = new FakeStore([target(koaRow, "Astoria/Warrenton KOA")]);

    const out = await locatePlaces({ rows: [koaRow], provider: new StubPlacesProvider(), store });

    expect(out).toEqual({ located: 0, stillUnmapped: 1, results: [] });
  });

  it("counts a write that matched no row as still unmapped", async () => {
    const provider = new FakeProvider({ "Astoria/Warrenton KOA": [KOA] });
    const store = new FakeStore([target(koaRow, "Astoria/Warrenton KOA")], false);

    const out = await locatePlaces({ rows: [koaRow], provider, store });

    expect(out).toEqual({ located: 0, stillUnmapped: 1, results: [] });
  });

  it("bills a duplicated row once and counts it once", async () => {
    const provider = new FakeProvider({ "Astoria/Warrenton KOA": [KOA] });
    const store = new FakeStore([target(koaRow, "Astoria/Warrenton KOA")]);

    const out = await locatePlaces({ rows: [koaRow, koaRow], provider, store });

    expect(out.located).toBe(1);
    expect(out.stillUnmapped).toBe(0);
    expect(provider.searches).toHaveLength(1);
  });

  it("answers an empty batch without asking anything", async () => {
    const provider = new FakeProvider();
    const out = await locatePlaces({ rows: [], provider, store: new FakeStore([]) });
    expect(out).toEqual({ located: 0, stillUnmapped: 0, results: [] });
    expect(provider.searches).toEqual([]);
  });
});

// ── the completion copy (§6 state 4) ───────────────────────────────────────
describe("locateToastMessage", () => {
  it("names the one row Google still cannot place — the frame's copy, verbatim", () => {
    expect(locateToastMessage(1, ["Forest Road 25 pullout"])).toBe(
      "Located 1 of 2. Forest Road 25 pullout still has no coordinates.",
    );
  });

  it("says only what it found when everything landed", () => {
    expect(locateToastMessage(2, [])).toBe("Located 2 of 2.");
  });

  it("joins two and three names, and pluralizes the verb", () => {
    expect(locateToastMessage(0, ["A", "B"])).toBe(
      "Located 0 of 2. A and B still have no coordinates.",
    );
    expect(locateToastMessage(1, ["A", "B", "C"])).toBe(
      "Located 1 of 4. A, B and C still have no coordinates.",
    );
  });

  it("stops listing past three and counts the rest", () => {
    expect(locateToastMessage(0, ["A", "B", "C", "D"])).toBe(
      "Located 0 of 4. A, B and 2 more still have no coordinates.",
    );
  });
});
