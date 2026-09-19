import { eq, sql } from "drizzle-orm";
import { placeEnrichment, type PlaceDetails, type PlacesCacheStore } from "@rv-trip/core";
import { db } from "./index";
import { places } from "./schema";

/**
 * The `PlacesCacheStore` @rv-trip/core's `detailsPlacesEnvelope` runs against
 * (#82 §7⑤) — core declares the seam, db implements it, exactly as
 * `LocateStore` / `dbLocateStore` already split.
 *
 * Not owner-scoped: the row has no owner. A place's rating, review count,
 * website, phone and canonical map page are the same facts for everybody, which
 * is what makes one shared 30-day row honest.
 *
 * The TTL is NOT applied here. `detailsPlacesEnvelope` owns it, against its own
 * injectable clock, so the freshness rule is unit-tested in core rather than
 * split across a SQL interval and a JS comparison that can disagree.
 */
export function dbPlacesCache(): PlacesCacheStore {
  return {
    async get(googlePlaceId: string) {
      const [row] = await db
        .select()
        .from(places)
        .where(eq(places.googlePlaceId, googlePlaceId))
        .limit(1);
      if (!row) return null;
      // Through the grammar, not straight off the row: a column that has drifted
      // (or a hand-written row) is a cache miss, never a malformed answer.
      const parsed = placeEnrichment.safeParse({
        googlePlaceId: row.googlePlaceId,
        name: row.displayName,
        rating: row.rating,
        userRatingCount: row.userRatingCount,
        websiteUri: row.websiteUri,
        nationalPhoneNumber: row.nationalPhoneNumber,
        googleMapsUri: row.googleMapsUri,
      });
      if (!parsed.success) return null;
      const e = parsed.data;
      return {
        details: {
          googlePlaceId: e.googlePlaceId,
          name: e.name,
          rating: e.rating,
          // The cache remembers only what the G-line renders; a caller that
          // needs coordinates or a formatted address asks the row that owns
          // them (stops / ideas / saved_places), never this one.
          location: null,
          address: null,
          userRatingCount: e.userRatingCount,
          websiteUri: e.websiteUri,
          nationalPhoneNumber: e.nationalPhoneNumber,
          googleMapsUri: e.googleMapsUri,
        } satisfies PlaceDetails,
        fetchedAt: row.fetchedAt,
      };
    },

    async put(details: PlaceDetails) {
      await db
        .insert(places)
        .values({
          googlePlaceId: details.googlePlaceId,
          displayName: details.name,
          rating: details.rating,
          userRatingCount: details.userRatingCount,
          websiteUri: details.websiteUri,
          nationalPhoneNumber: details.nationalPhoneNumber,
          googleMapsUri: details.googleMapsUri,
        })
        // Upsert on the key, so a stale row is refreshed in place (there is no
        // sweeper). `fetched_at` comes from the DATABASE clock on both paths —
        // the column default on insert, `now()` here — so a row's age is never
        // measured against a different machine's clock.
        .onConflictDoUpdate({
          target: places.googlePlaceId,
          set: {
            displayName: sql`excluded.display_name`,
            rating: sql`excluded.rating`,
            userRatingCount: sql`excluded.user_rating_count`,
            websiteUri: sql`excluded.website_uri`,
            nationalPhoneNumber: sql`excluded.national_phone_number`,
            googleMapsUri: sql`excluded.google_maps_uri`,
            fetchedAt: sql`now()`,
          },
        });
    },
  };
}
