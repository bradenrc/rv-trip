import { expect, it } from "vitest";
import { dbPlacesCache } from "@rv-trip/db";
import type { PlaceDetails } from "@rv-trip/core";
import { GET } from "@/app/api/places/details/[id]/route";
import { ctx, describeDb, req } from "@/test/db";

/**
 * The G-line's wire (#82 §7④) — what `GET /api/places/details/[id]` actually
 * answers, in OUR field names, and the 30-day `places` cache it reads first.
 *
 * Deliberately provider-INDEPENDENT: every case here either fails validation or
 * is answered by a fresh cache row, which short-circuits before the provider is
 * ever consulted. So this suite behaves identically with a GOOGLE_API_KEY set
 * and without one, and never spends a billed request. The TTL, the miss, the
 * write-through and the four degraded paths are unit-tested against a fake
 * clock in packages/core's `detailsPlacesEnvelope`.
 */

const KOA: PlaceDetails = {
  googlePlaceId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
  name: "Astoria/Warrenton KOA",
  location: { lat: 46.1885, lng: -123.9432 },
  rating: 4.6,
  address: "1100 NW Ridge Rd, Hammond, OR 97121",
  userRatingCount: 812,
  websiteUri: "https://koa.com/campgrounds/astoria/",
  nationalPhoneNumber: "(503) 325-0013",
};

describeDb("GET /api/places/details/[id]", () => {
  it("answers a cached row on the shipped envelope, in our field names", async () => {
    await dbPlacesCache().put(KOA);

    const res = await GET(req(undefined, "GET"), ctx(KOA.googlePlaceId));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [
        {
          googlePlaceId: KOA.googlePlaceId,
          name: KOA.name,
          rating: 4.6,
          // The cache remembers only what the G-line renders; the picker asks
          // /api/places/search for coordinates and gets them there.
          location: null,
          address: null,
          userRatingCount: 812,
          websiteUri: "https://koa.com/campgrounds/astoria/",
          nationalPhoneNumber: "(503) 325-0013",
        },
      ],
      degraded: false,
    });
  });

  it("400s a blank id — a malformed segment is a client bug, not a degradation", async () => {
    const res = await GET(req(undefined, "GET"), ctx("   "));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
  });

  it("upserts on the key rather than growing a second row", async () => {
    await dbPlacesCache().put(KOA);
    await dbPlacesCache().put({ ...KOA, rating: 4.7, userRatingCount: 913 });

    const hit = await dbPlacesCache().get(KOA.googlePlaceId);
    expect(hit?.details.rating).toBe(4.7);
    expect(hit?.details.userRatingCount).toBe(913);

    const res = await GET(req(undefined, "GET"), ctx(KOA.googlePlaceId));
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toHaveLength(1);
  });

  it("is a MISS for an id nothing has cached — never a half-filled row", async () => {
    expect(await dbPlacesCache().get("ChIJ_never_seen")).toBeNull();
  });

  it("keeps a place Google told us nothing about — nulls, not absent keys", async () => {
    const bare: PlaceDetails = {
      googlePlaceId: "ChIJ_bare",
      name: "Somewhere",
      location: null,
      rating: null,
      address: null,
      userRatingCount: null,
      websiteUri: null,
      nationalPhoneNumber: null,
    };
    await dbPlacesCache().put(bare);
    const hit = await dbPlacesCache().get("ChIJ_bare");
    expect(hit?.details).toEqual(bare);
  });
});
