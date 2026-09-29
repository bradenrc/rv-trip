import type { PlaceSearchType } from "./places-search";
import type { IsoDate } from "../domain/types";
import type { RigProfileInput } from "../domain/rig";
import { encodeFlexiblePolyline } from "./polyline";

/**
 * Maps live behind interfaces so feature code never touches a vendor and
 * providers can be swapped or A/B tested. Routing is HERE (RV-safe truck
 * routing), places are Google, display is Mapbox GL. Local dev uses the stub
 * implementations — no network, no keys.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** Where a drive's numbers came from. "estimate" is an unfinished measurement,
 * not a warning — no rig yet, no credentials, or a provider error. */
export type RouteSource = "here" | "estimate";

/** What the rig ran into. Amber is reserved for exactly this. */
export interface RouteNotice {
  /** The vendor's code, kept verbatim for debugging. */
  code: string;
  kind: "height" | "width" | "length" | "weight" | "propane" | "other";
  roadName: string | null;
  limitMeters: number | null;
  /** Server-composed so the copy lives in one place and the client never
   * string-builds a clearance. */
  message: string;
}

/**
 * A routed drive between two stops. (G6: this was `RouteLeg`, which collided
 * with the trip leg of the same name in apps/web/src/lib/trip-logic.ts — the
 * one RouteView actually imports. It is a route result, not a leg of a trip.)
 */
export interface RouteResult {
  /** driving time in seconds */
  durationSeconds: number;
  /** driving distance in meters */
  distanceMeters: number;
  /** HERE flexible polyline, or the stub's two-point straight line. Carried,
   * not yet consumed — the map layer and the corridor-faithful handoff are
   * fast-follows; the Navigate link is endpoints-only. */
  polyline: string | null;
  /** The road the drive mostly runs on ("US-101"), when the vendor names one. */
  primaryRoad: string | null;
  source: RouteSource;
  /** Empty is the normal case — most drives collapse to a single mono line. */
  notices: RouteNotice[];
}

/** Drive time/distance between adjacent stops. Implemented by HERE in prod. */
export interface RoutingProvider {
  route(from: LatLng, to: LatLng, rig?: RigProfileInput | null): Promise<RouteResult>;
}

export interface PlaceSummary {
  googlePlaceId: string;
  name: string;
  location: LatLng | null;
  rating: number | null;
  address: string | null;
  /**
   * Google's `primaryType` ("restaurant") and its display name ("Restaurant")
   * — SEARCH rows only (#111): the capture sheet's tile comes from the first
   * through `reservationTypeOfGoogle`, its subline from the second. Optional so
   * a details answer, a cached row and every older fake stay a PlaceSummary.
   */
  primaryType?: string | null;
  primaryTypeDisplayName?: string | null;
}

/**
 * A save's locality (#111 · docs/design/111 "One resolver"). `name` is the
 * shelf heading ("Bandon, OR" in the US, "San José, Costa Rica" elsewhere) and
 * `region` the header above it ("Oregon" / "Costa Rica"). `lat`/`lng` are the
 * LOCALITY's, stored on the destinations row so an area save with no
 * coordinates of its own still has a point to be measured from.
 */
export interface ResolvedDestination {
  googlePlaceId: string;
  name: string;
  region: string | null;
  lat: number;
  lng: number;
}

/** A locality further than this from the point is not the point's town. */
export const DESTINATION_MAX_MILES = 25;

/**
 * What a DETAILS call answers with (#82 §7①, #91) — `PlaceSummary` plus the
 * four fields the quiet Google line renders.
 *
 * A separate type rather than four more fields on `PlaceSummary`, because one
 * type served both calls and both mappers: the first three below are
 * Enterprise-SKU fields, and widening `PlaceSummary` would push them onto
 * `places:searchText`, billed per result of every keystroke-driven search.
 * `googleMapsUri` (#91) is NOT an Enterprise-SKU field — it lives here because
 * the search path has nothing to do with it, not because of billing. It EXTENDS
 * `PlaceSummary`, so every existing `details()` caller still typechecks
 * unchanged.
 */
export interface PlaceDetails extends PlaceSummary {
  userRatingCount: number | null;
  websiteUri: string | null;
  nationalPhoneNumber: string | null;
  /** Google's own canonical place page — never a URL we assemble. */
  googleMapsUri: string | null;
}

/** Place search + details/reviews. Implemented by Google Places in prod. */
export interface PlacesProvider {
  search(query: string, near?: LatLng, type?: PlaceSearchType): Promise<PlaceSummary[]>;
  details(googlePlaceId: string): Promise<PlaceDetails | null>;
  /**
   * Reverse-geocode a point to its locality (#111). `null` when there is none
   * within {@link DESTINATION_MAX_MILES}. Throws on an upstream failure, like
   * `search`; the save path turns that into a null destination.
   */
  resolveDestination(lat: number, lng: number): Promise<ResolvedDestination | null>;
}

/** The nominal RV highway speed the straight-line estimate assumes. */
export const ESTIMATE_AVG_KMH = 75;

/**
 * The straight-line fallback — pure, synchronous, no network, no keys.
 *
 * It has to stay synchronous: routeModel/routeSummary run inside a useMemo in a
 * "use client" component, so the cache-key-miss path (you dragged a floating
 * stop and invented a pair the server never routed) cannot await anything.
 * StubRoutingProvider wraps this to satisfy the async RoutingProvider
 * interface; both are the same arithmetic, which is the point — there used to
 * be two haversines at two different nominal speeds.
 */
export function estimateRoute(from: LatLng, to: LatLng, avgKmh = ESTIMATE_AVG_KMH): RouteResult {
  const km = haversineMeters(from, to) / 1000;
  // Round to whole minutes first, so the rendered "2h 19m" is this arithmetic
  // rather than a re-rounding of it.
  const minutes = Math.round((km / avgKmh) * 60);
  return {
    durationSeconds: minutes * 60,
    distanceMeters: Math.round(km * 1000),
    polyline: encodeFlexiblePolyline([from, to]),
    primaryRoad: null,
    source: "estimate",
    notices: [],
  };
}

/**
 * Deterministic local stub. Good enough to build and design against; real
 * routing swaps in behind the same interface, and every pipeline stage keeps
 * working with nothing configured.
 */
export class StubRoutingProvider implements RoutingProvider {
  constructor(private readonly avgKmh = ESTIMATE_AVG_KMH) {}

  async route(from: LatLng, to: LatLng): Promise<RouteResult> {
    return estimateRoute(from, to, this.avgKmh);
  }
}

export class StubPlacesProvider implements PlacesProvider {
  async search(): Promise<PlaceSummary[]> {
    return [];
  }
  /**
   * Still `null`, and that is the whole point (#82 §7 state ④): only the RETURN
   * TYPE moved. An object of nulls would make `detailsPlacesEnvelope` answer
   * `results: [<hollow row>]` instead of `[]`, and the G-line would render
   * "G ★ — · —" in the one state that is normal in every local, CI and walk
   * environment. No provider means no line at all.
   */
  async details(): Promise<PlaceDetails | null> {
    return null;
  }
  /** No key, no locality: every save is written with a null destination. */
  async resolveDestination(): Promise<ResolvedDestination | null> {
    return null;
  }
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const dLat = deg2rad(b.lat - a.lat);
  const dLng = deg2rad(b.lng - a.lng);
  const lat1 = deg2rad(a.lat);
  const lat2 = deg2rad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}

export * from "./polyline";
export * from "./frechet";
export * from "./navigation";
export * from "./places-search";
export * from "./places-locate";
export * from "./place-picker";
export * from "./route-format";
export * from "./notices";

export type { IsoDate };
