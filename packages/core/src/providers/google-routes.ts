import { discreteFrechet, withinCorridor } from "./frechet";
import { type GoogleCredentials } from "./google-places";
import { haversineMeters, type LatLng } from "./index";
import type { NavCheck } from "./navigation";

/**
 * Google Routes (`directions/v2:computeRoutes`) — SERVER SIDE ONLY.
 *
 * Deliberately NOT re-exported from providers/index.ts: this file holds a
 * credential and `fetch`, and must never be pulled into a client bundle. Import
 * it by its subpath (`@rv-trip/core/providers/google-routes`) from server code —
 * the same quarantine providers/here.ts and providers/google-places.ts
 * document, comment and all. (`frechet.ts`, which this feeds, IS on the barrel:
 * it is pure math.)
 *
 * What it is for (docs/design/43 §4): Google's `dir/?api=1` deep link cannot
 * carry a pass-through waypoint, so the link we hand a driver is the two
 * endpoints and nothing else. This client does not change that link — it asks
 * Google, server-side, whether Google's own answer for those endpoints IS the
 * corridor HERE cleared for the rig, so the UI can stop guessing.
 *
 * NOT yet exercised against live Google: GOOGLE_API_KEY is unset locally, so
 * `checkCorridor` is never constructed there and every drive renders verdict
 * "plain". The live round-trip is the walk's job.
 *
 * Failure policy: HERE's, not Places'. A failed or unreadable check is
 * `deviationMeters: null` — "we do not know" — which renders as the shipped
 * amber "plain" state. It never throws into a page render, because a trip you
 * cannot open is worse than a Navigate button with no badge on it.
 */

export const COMPUTE_ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

/** The ONE field the validator needs. Nothing else is requested, ever. */
export const COMPUTE_ROUTES_FIELD_MASK = "routes.polyline.geoJsonLinestring";

/**
 * The cap on sampled `via` points. More than eight and both the request's cost
 * and its size stop being reasonable — and a corridor that needs nine hints is
 * a corridor Google is not going to hold anyway.
 */
export const MAX_VIA_POINTS = 8;

export function buildComputeRoutesBody(
  origin: LatLng,
  destination: LatLng,
  intermediates: LatLng[],
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    origin: { location: { latLng: latLng(origin) } },
    destination: { location: { latLng: latLng(destination) } },
  };
  // `via: true` is the whole reason this is a server call and not a URL: it is
  // a pass-through hint, NOT a stop. The deep-link scheme has no equivalent,
  // which is why every coordinate in `waypoints=` gets snapped to an address.
  if (intermediates.length > 0) {
    body.intermediates = intermediates.map((p) => ({ location: { latLng: latLng(p) }, via: true }));
  }
  body.travelMode = "DRIVE";
  body.polylineEncoding = "GEO_JSON_LINESTRING";
  return body;
}

/**
 * Where to hint Google, picked off the HERE corridor.
 *
 * The profile is the distance from each corridor vertex to the nearest vertex
 * of Google's answer. Its LOCAL MAXIMA are the middles of the stretches where
 * the two disagree — one hint per disagreement, which is exactly what a
 * pass-through point is for. Sampling the global top-N instead would spend all
 * eight hints on one wrong turn.
 *
 * Endpoints are never sampled (the request already carries both), the sample is
 * capped at `cap` worst-first, and the result is returned in TRAVERSAL order —
 * `intermediates` is a sequence Google drives through, so order is the route.
 */
export function sampleViaPoints(
  corridor: LatLng[],
  other: LatLng[],
  cap = MAX_VIA_POINTS,
): LatLng[] {
  if (corridor.length < 3 || other.length === 0) return [];
  const profile = corridor.map((p) => nearestMeters(p, other));

  const maxima: { index: number; meters: number }[] = [];
  for (let i = 1; i < corridor.length - 1; i++) {
    if (profile[i]! > profile[i - 1]! && profile[i]! >= profile[i + 1]!) {
      maxima.push({ index: i, meters: profile[i]! });
    }
  }
  return maxima
    .sort((a, b) => b.meters - a.meters)
    .slice(0, cap)
    .sort((a, b) => a.index - b.index)
    .map((m) => corridor[m.index]!);
}

/** The geometry of Google's first route, or none at all. Never throws. */
export function parseComputeRoutesResponse(body: unknown): LatLng[] {
  const coordinates = (
    body as {
      routes?: { polyline?: { geoJsonLinestring?: { coordinates?: unknown } } }[];
    } | null
  )?.routes?.[0]?.polyline?.geoJsonLinestring?.coordinates;
  if (!Array.isArray(coordinates)) return [];
  const points: LatLng[] = [];
  for (const pair of coordinates) {
    // GeoJSON is [lng, lat] — the reverse of LatLng, and the one mistake that
    // would make every deviation enormous and every verdict "plain".
    if (!Array.isArray(pair) || typeof pair[0] !== "number" || typeof pair[1] !== "number") {
      return [];
    }
    points.push({ lat: pair[1], lng: pair[0] });
  }
  return points;
}

export class GoogleRoutesProvider {
  constructor(private readonly credentials: GoogleCredentials) {}

  /**
   * The billable check, in at most two calls (docs/design/43 §4):
   *
   *  ① ask for the endpoints only — that is the route the handoff URL yields —
   *    and measure it against the corridor. Inside tolerance, we are done and
   *    it cost one call.
   *  ② outside tolerance, re-ask with up to eight sampled `via` hints. That
   *    second answer is what Google can hold WHEN ASKED, reported as
   *    `shapedDeviationMeters` and never as the verdict: the URL we hand over
   *    carries no hints, so a label made of the hinted answer would be a label
   *    about a route the driver does not get.
   */
  async checkCorridor(origin: LatLng, destination: LatLng, corridor: LatLng[]): Promise<NavCheck> {
    if (corridor.length < 2) return { deviationMeters: null, intermediates: [] };
    try {
      const plain = await this.compute(origin, destination, []);
      if (plain.length < 2) return { deviationMeters: null, intermediates: [] };
      const deviationMeters = discreteFrechet(corridor, plain);
      if (withinCorridor(deviationMeters)) {
        return { deviationMeters, shapedDeviationMeters: deviationMeters, intermediates: [] };
      }

      const intermediates = sampleViaPoints(corridor, plain);
      if (intermediates.length === 0) return { deviationMeters, intermediates: [] };
      const shaped = await this.compute(origin, destination, intermediates);
      return {
        deviationMeters,
        shapedDeviationMeters: shaped.length >= 2 ? discreteFrechet(corridor, shaped) : null,
        intermediates,
      };
    } catch {
      // A vendor failure is "we do not know", cached as such so a dead end is
      // paid for once — never an error on a page the driver is trying to read.
      return { deviationMeters: null, intermediates: [] };
    }
  }

  private async compute(
    origin: LatLng,
    destination: LatLng,
    intermediates: LatLng[],
  ): Promise<LatLng[]> {
    const res = await fetch(COMPUTE_ROUTES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": this.credentials.apiKey,
        "X-Goog-FieldMask": COMPUTE_ROUTES_FIELD_MASK,
      },
      body: JSON.stringify(buildComputeRoutesBody(origin, destination, intermediates)),
    });
    if (!res.ok) throw new Error(`Google computeRoutes → ${res.status}`);
    return parseComputeRoutesResponse(await res.json());
  }
}

function latLng(p: LatLng): { latitude: number; longitude: number } {
  return { latitude: p.lat, longitude: p.lng };
}

/** How far `p` is from the nearest VERTEX of `other`. */
function nearestMeters(p: LatLng, other: LatLng[]): number {
  let best = Infinity;
  for (const q of other) {
    const d = haversineMeters(p, q);
    if (d < best) best = d;
  }
  return best;
}
