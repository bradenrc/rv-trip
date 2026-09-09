import type { LatLng, PlaceSummary, PlacesProvider } from "./index";

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

/**
 * Exactly the five fields PlaceSummary carries — nothing else is requested, so
 * we stay in the cheapest SKU and never receive data we have no place to put.
 */
const PLACE_FIELDS = ["id", "displayName", "location", "rating", "formattedAddress"] as const;
export const DETAILS_FIELD_MASK = PLACE_FIELDS.join(",");
export const SEARCH_FIELD_MASK = PLACE_FIELDS.map((f) => `places.${f}`).join(",");

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

  async details(googlePlaceId: string): Promise<PlaceSummary | null> {
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
}

/** Text Search wraps its hits in `places`, and omits the key entirely on none. */
export function parseSearchResponse(body: unknown): PlaceSummary[] {
  const places = (body as { places?: GooglePlace[] } | null)?.places ?? [];
  return places
    .map((place) => toPlaceSummary(place))
    .filter((place): place is PlaceSummary => place !== null);
}

/** Details answers with the place itself, unwrapped. */
export function parseDetailsResponse(body: unknown): PlaceSummary | null {
  return toPlaceSummary(body as GooglePlace | null);
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
