import {
  DESTINATION_MAX_MILES,
  haversineMeters,
  type LatLng,
  type PlaceDetails,
  type PlaceSummary,
  type PlacesProvider,
  type ResolvedDestination,
} from "./index";

/**
 * Google Places (New) — SERVER SIDE ONLY.
 *
 * Deliberately NOT re-exported from providers/index.ts: this file holds a
 * credential and `fetch`, and must never be pulled into a client bundle. Import
 * it by its subpath (`@rv-trip/core/providers/google-places`) from server code —
 * the same quarantine providers/here.ts documents, comment and all.
 *
 * NOT yet exercised against live Google: GOOGLE_API_KEY is unset locally, so
 * every local path resolves through StubPlacesProvider (providers/index.ts) and
 * the route's degraded envelope. The live round-trip is the walk's job.
 *
 * The failure policy differs from HERE's on purpose. Routing degrades INSIDE the
 * provider because `estimateRoute` is a real answer; places have no such
 * fallback, and an empty result list is a fact ("Google had nothing", §4 state
 * 4), not a degradation. So an upstream failure THROWS here and the caller — the
 * search route — turns it into `{ degraded: true, reason: "upstream_error" }`.
 * Swallowing it would make "no matches" and "Google is down" the same answer. A
 * place id Google no longer knows is not a failure either: `details` returns
 * null.
 */

/** Text Search (New). One POST, results shaped by the field mask below. */
export const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
/** Place Details (New). GET .../places/{PLACE_ID}. */
export const DETAILS_URL_BASE = "https://places.googleapis.com/v1/places/";
/** Geocoding API — the reverse lookup behind `resolveDestination` (#111). Needs
 * the Geocoding API enabled on the same key (an operator step). */
export const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

/**
 * Exactly the five fields PlaceSummary carries — nothing else is requested, so
 * we stay in the cheapest SKU and never receive data we have no place to put.
 */
const PLACE_FIELDS = ["id", "displayName", "location", "rating", "formattedAddress"] as const;

/**
 * The two masks FORK (#82 §7②). `userRatingCount` / `websiteUri` /
 * `nationalPhoneNumber` are Enterprise-SKU fields; on `places:searchText` they
 * would bill on EVERY RESULT of every keystroke-driven search. Details only —
 * one call, one pick, and search keeps its cheap five.
 *
 * `googleMapsUri` (#91) joins the DETAILS side of the fork for the second
 * reason rather than the first: it is not an Enterprise-SKU field, but it has
 * no home on `PlaceSummary` and the picker has nothing to do with it, so
 * requesting it per search result would be data we have no place to put.
 */
const DETAILS_FIELDS = [
  ...PLACE_FIELDS,
  "userRatingCount",
  "websiteUri",
  "nationalPhoneNumber",
  "googleMapsUri",
] as const;

export const DETAILS_FIELD_MASK = DETAILS_FIELDS.join(",");
/**
 * Search's cheap five, plus the two type fields the capture sheet needs (#111):
 * `primaryType` picks the row's category tile and `primaryTypeDisplayName`
 * leads its subline. Both are Pro-SKU fields, the same tier as `location` and
 * `formattedAddress`, so they cost nothing extra per result.
 */
const SEARCH_FIELDS = [...PLACE_FIELDS, "primaryType", "primaryTypeDisplayName"] as const;
export const SEARCH_FIELD_MASK = SEARCH_FIELDS.map((f) => `places.${f}`).join(",");

/**
 * How far around `near` the search leans. A BIAS, never a restriction — a
 * campground two states away is still findable, it just ranks below the one
 * beside the map's centre.
 */
export const SEARCH_BIAS_RADIUS_METERS = 50_000;

export interface GoogleCredentials {
  apiKey: string;
}

/** Reads the one Google value; null when it is missing (the local case). */
export function googleCredentialsFromEnv(
  env: Record<string, string | undefined> = process.env,
): GoogleCredentials | null {
  const apiKey = env.GOOGLE_API_KEY;
  if (!apiKey) return null;
  return { apiKey };
}

export function buildSearchBody(query: string, near?: LatLng): Record<string, unknown> {
  const body: Record<string, unknown> = { textQuery: query };
  if (near) {
    body.locationBias = {
      circle: {
        center: { latitude: near.lat, longitude: near.lng },
        radius: SEARCH_BIAS_RADIUS_METERS,
      },
    };
  }
  return body;
}

export class GooglePlacesProvider implements PlacesProvider {
  constructor(private readonly credentials: GoogleCredentials) {}

  async search(query: string, near?: LatLng): Promise<PlaceSummary[]> {
    const textQuery = query.trim();
    // A blank box is not a question. Never spend a billed request on it.
    if (!textQuery) return [];
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": this.credentials.apiKey,
        "X-Goog-FieldMask": SEARCH_FIELD_MASK,
      },
      body: JSON.stringify(buildSearchBody(textQuery, near)),
    });
    if (!res.ok) throw new Error(`Google places:searchText → ${res.status}`);
    return parseSearchResponse(await res.json());
  }

  async details(googlePlaceId: string): Promise<PlaceDetails | null> {
    const res = await fetch(`${DETAILS_URL_BASE}${encodeURIComponent(googlePlaceId)}`, {
      headers: {
        "X-Goog-Api-Key": this.credentials.apiKey,
        "X-Goog-FieldMask": DETAILS_FIELD_MASK,
      },
    });
    // An id we hold that Google has retired is an answer, not an outage.
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Google places/details → ${res.status}`);
    return parseDetailsResponse(await res.json());
  }

  async resolveDestination(lat: number, lng: number): Promise<ResolvedDestination | null> {
    const url = `${GEOCODE_URL}?latlng=${lat},${lng}&result_type=locality&key=${encodeURIComponent(
      this.credentials.apiKey,
    )}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Google geocode → ${res.status}`);
    const body = (await res.json()) as { status?: string };
    // ZERO_RESULTS is an answer — the middle of the Alvord Desert has no town.
    if (body?.status === "ZERO_RESULTS") return null;
    if (body?.status !== "OK") throw new Error(`Google geocode → ${body?.status ?? "no status"}`);
    return parseReverseGeocode(body, { lat, lng });
  }
}

// ── response mapping ───────────────────────────────────────────────────────
interface GoogleLatLng {
  latitude?: number;
  longitude?: number;
}
interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  location?: GoogleLatLng;
  rating?: number;
  formattedAddress?: string;
  /** Search only (#111). */
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  /** Details only — requested by DETAILS_FIELD_MASK and by nothing else. */
  userRatingCount?: number;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  googleMapsUri?: string;
}

/**
 * Text Search wraps its hits in `places`, and omits the key entirely on none.
 * Search rows carry the two type fields (#111); details rows never do, which is
 * why they are added here and not in the shared `toPlaceSummary`.
 */
export function parseSearchResponse(body: unknown): PlaceSummary[] {
  const places = (body as { places?: GooglePlace[] } | null)?.places ?? [];
  return places.flatMap((place) => {
    const summary = toPlaceSummary(place);
    if (!summary) return [];
    return [
      {
        ...summary,
        primaryType: place.primaryType ?? null,
        primaryTypeDisplayName: place.primaryTypeDisplayName?.text ?? null,
      },
    ];
  });
}

// ── the reverse geocode (#111) ─────────────────────────────────────────────
interface GeocodeComponent {
  long_name?: string;
  short_name?: string;
  types?: string[];
}
interface GeocodeResult {
  place_id?: string;
  address_components?: GeocodeComponent[];
  geometry?: { location?: { lat?: number; lng?: number } };
}

const METERS_PER_MILE = 1609.344;

/**
 * A Geocoding API reverse answer (`result_type=locality`) → the destination,
 * or null. The rule is docs/design/111's, and it is one rule for everywhere:
 *
 * - the locality must be within {@link DESTINATION_MAX_MILES} of the point,
 *   measured to the locality's own geometry, or the save is unanchored;
 * - in the US the name is "Locality, ST" and the region the state's long name
 *   ("Bandon, OR" · "Oregon");
 * - anywhere else the name is "Locality, Country" and the region the country
 *   ("San José, Costa Rica" · "Costa Rica").
 */
export function parseReverseGeocode(body: unknown, point: LatLng): ResolvedDestination | null {
  const results = (body as { results?: GeocodeResult[] } | null)?.results ?? [];
  for (const result of results) {
    const comps = result.address_components ?? [];
    const find = (type: string) => comps.find((c) => c.types?.includes(type));
    const locality = find("locality")?.long_name;
    const loc = result.geometry?.location;
    if (!result.place_id || !locality) continue;
    if (typeof loc?.lat !== "number" || typeof loc?.lng !== "number") continue;
    const at = { lat: loc.lat, lng: loc.lng };
    if (haversineMeters(point, at) > DESTINATION_MAX_MILES * METERS_PER_MILE) return null;
    const admin = find("administrative_area_level_1");
    const country = find("country");
    const us = country?.short_name === "US";
    const name = us
      ? admin?.short_name
        ? `${locality}, ${admin.short_name}`
        : locality
      : country?.long_name
        ? `${locality}, ${country.long_name}`
        : locality;
    const region = (us ? admin?.long_name : country?.long_name) ?? null;
    return { googlePlaceId: result.place_id, name, region, lat: at.lat, lng: at.lng };
  }
  return null;
}

/** Details answers with the place itself, unwrapped. */
export function parseDetailsResponse(body: unknown): PlaceDetails | null {
  return toPlaceDetails(body as GooglePlace | null);
}

/**
 * The details mapper WRAPS the search mapper rather than replacing it (#82
 * §7②). Widening `toPlaceSummary` in place is exactly what would re-couple the
 * two paths — and silently drop the four details-only fields on the floor if it
 * were left alone, which is the trap this fork exists to disarm.
 */
function toPlaceDetails(place: GooglePlace | null | undefined): PlaceDetails | null {
  // The same id/name guard, decided once and in one place.
  const summary = toPlaceSummary(place);
  if (!summary) return null;
  return {
    ...summary,
    userRatingCount: typeof place?.userRatingCount === "number" ? place.userRatingCount : null,
    websiteUri: place?.websiteUri ?? null,
    nationalPhoneNumber: place?.nationalPhoneNumber ?? null,
    googleMapsUri: place?.googleMapsUri ?? null,
  };
}

function toPlaceSummary(place: GooglePlace | null | undefined): PlaceSummary | null {
  const googlePlaceId = place?.id;
  const name = place?.displayName?.text;
  // location / rating / address are all nullable on PlaceSummary; the id and
  // the name are not. A row missing either is a row nothing can be saved
  // against, so it is dropped rather than faked.
  if (!googlePlaceId || !name) return null;
  return {
    googlePlaceId,
    name,
    location: toLatLng(place?.location),
    rating: typeof place?.rating === "number" ? place.rating : null,
    address: place?.formattedAddress ?? null,
  };
}

/** Half a pin is no pin — a coordless place is legal, a wrong one is not. */
function toLatLng(location: GoogleLatLng | undefined): LatLng | null {
  if (typeof location?.latitude !== "number" || typeof location?.longitude !== "number") {
    return null;
  }
  return { lat: location.latitude, lng: location.longitude };
}
