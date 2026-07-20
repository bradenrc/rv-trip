import type { IsoDate } from "../domain/types";

/**
 * Maps live behind interfaces so feature code never touches a vendor and
 * providers can be swapped or A/B tested. v1 target: Mapbox for routing,
 * Google Places for places/reviews. Local dev uses the stub implementations.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteLeg {
  /** driving time in seconds */
  durationSeconds: number;
  /** driving distance in meters */
  distanceMeters: number;
}

/** Drive time/distance between adjacent stops. Implemented by Mapbox in prod. */
export interface RoutingProvider {
  route(from: LatLng, to: LatLng): Promise<RouteLeg>;
}

export interface PlaceSummary {
  googlePlaceId: string;
  name: string;
  location: LatLng | null;
  rating: number | null;
  address: string | null;
}

/** Place search + details/reviews. Implemented by Google Places in prod. */
export interface PlacesProvider {
  search(query: string, near?: LatLng): Promise<PlaceSummary[]>;
  details(googlePlaceId: string): Promise<PlaceSummary | null>;
}

/**
 * Deterministic local stub — no network, no keys. Estimates drive time from a
 * straight-line distance at a nominal RV highway speed. Good enough to build
 * and design against; real routing swaps in behind the same interface.
 */
export class StubRoutingProvider implements RoutingProvider {
  constructor(private readonly avgKmh = 80) {}

  async route(from: LatLng, to: LatLng): Promise<RouteLeg> {
    const distanceMeters = haversineMeters(from, to);
    const durationSeconds = (distanceMeters / 1000 / this.avgKmh) * 3600;
    return {
      distanceMeters: Math.round(distanceMeters),
      durationSeconds: Math.round(durationSeconds),
    };
  }
}

export class StubPlacesProvider implements PlacesProvider {
  async search(): Promise<PlaceSummary[]> {
    return [];
  }
  async details(): Promise<PlaceSummary | null> {
    return null;
  }
}

function haversineMeters(a: LatLng, b: LatLng): number {
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

export type { IsoDate };
