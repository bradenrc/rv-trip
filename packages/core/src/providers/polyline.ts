import type { LatLng, RouteResult } from "./index";

/**
 * HERE's "flexible polyline" codec — the encoding `RouteResult.polyline`
 * carries. `encode` is live: StubRoutingProvider encodes its two-point straight
 * line so local dev produces the same shape with no network and no keys.
 *
 * `decode` has ONE consumer: `routeToGeoJSON` below, the corridor the Mapbox
 * layer draws (docs/design/43 §2). The other half of the fast-follow —
 * server-side Google Routes intermediates validated against the HERE geometry
 * — reads the same decode and is still ahead of us.
 *
 * Format: a version varint, a header varint carrying the coordinate precision,
 * then zig-zag-encoded signed varint deltas over base-64url-ish characters with
 * 0x20 as the continuation bit.
 */

const ENCODING = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
const DECODING: Record<string, number> = {};
for (let i = 0; i < ENCODING.length; i++) DECODING[ENCODING[i]!] = i;

const FORMAT_VERSION = 1;
const DEFAULT_PRECISION = 5;

export function encodeFlexiblePolyline(points: LatLng[], precision = DEFAULT_PRECISION): string {
  if (points.length === 0) return "";
  const factor = 10 ** precision;
  const out: string[] = [];
  encodeUnsigned(FORMAT_VERSION, out);
  // headerContent = (thirdDimPrecision << 7) | (thirdDim << 4) | precision.
  // We never carry a third dimension, so both third-dim fields are 0.
  encodeUnsigned(precision, out);

  let lastLat = 0;
  let lastLng = 0;
  for (const p of points) {
    const lat = Math.round(p.lat * factor);
    const lng = Math.round(p.lng * factor);
    encodeSigned(lat - lastLat, out);
    encodeSigned(lng - lastLng, out);
    lastLat = lat;
    lastLng = lng;
  }
  return out.join("");
}

export function decodeFlexiblePolyline(encoded: string): LatLng[] {
  if (!encoded) return [];
  const cursor = { i: 0 };
  try {
    const version = decodeUnsigned(encoded, cursor);
    if (version !== FORMAT_VERSION) return [];
    const header = decodeUnsigned(encoded, cursor);
    const precision = header & 15;
    const thirdDim = (header >> 4) & 7;
    const factor = 10 ** precision;

    const points: LatLng[] = [];
    let lat = 0;
    let lng = 0;
    while (cursor.i < encoded.length) {
      lat += decodeSigned(encoded, cursor);
      lng += decodeSigned(encoded, cursor);
      // A third dimension (elevation etc.) is read and discarded — we only
      // ever plot the ground track.
      if (thirdDim) decodeSigned(encoded, cursor);
      points.push({ lat: lat / factor, lng: lng / factor });
    }
    return points;
  } catch {
    // An unreadable vendor polyline degrades to "no corridor" rather than
    // throwing. Never a crash on a vendor's encoding.
    return [];
  }
}

/**
 * A GeoJSON LineString, declared here rather than taken from the `GeoJSON`
 * global: `@types/geojson` is not a dependency of this package and its
 * tsconfig pins `types` to node + vitest/globals, so no such namespace exists.
 * The shape is exactly the object `MapView.tsx` used to build inline.
 */
export interface RouteLineString {
  type: "LineString";
  /** `[lng, lat]` — GeoJSON's order, the reverse of `LatLng`'s. */
  coordinates: [number, number][];
}

/**
 * The drawable geometry of a routed drive: the HERE corridor when the vendor
 * gave us one, the two endpoints otherwise.
 *
 * `from`/`to` are parameters because a `RouteResult` carries no endpoints — it
 * is a measurement of a pair, not the pair. They are the fallback for the two
 * cases where there is no corridor to draw: a result with `polyline: null`
 * (a vendor answer that carried none), and a polyline we cannot read
 * (`decodeFlexiblePolyline` degrades garbage to `[]`).
 *
 * An `estimate` needs no branch: `estimateRoute` encodes its own two endpoints,
 * so it decodes to the same two-point straight segment the map already drew.
 */
export function routeToGeoJSON(result: RouteResult, from: LatLng, to: LatLng): RouteLineString {
  const decoded = result.polyline ? decodeFlexiblePolyline(result.polyline) : [];
  const points = decoded.length >= 2 ? decoded : [from, to];
  return {
    type: "LineString",
    coordinates: points.map((p) => [p.lng, p.lat] as [number, number]),
  };
}

function encodeUnsigned(value: number, out: string[]): void {
  let v = value;
  while (v > 0x1f) {
    out.push(ENCODING[(v & 0x1f) | 0x20]!);
    v >>>= 5;
  }
  out.push(ENCODING[v]!);
}

function encodeSigned(value: number, out: string[]): void {
  // zig-zag: fold the sign into bit 0 so small negatives stay short.
  let v = value < 0 ? ~(value << 1) : value << 1;
  v >>>= 0;
  encodeUnsigned(v, out);
}

function decodeUnsigned(encoded: string, cursor: { i: number }): number {
  let result = 0;
  let shift = 0;
  while (cursor.i < encoded.length) {
    const ch = encoded[cursor.i++]!;
    const value = DECODING[ch];
    if (value === undefined) throw new Error("unreadable polyline");
    result |= (value & 0x1f) << shift;
    if ((value & 0x20) === 0) return result >>> 0;
    shift += 5;
    if (shift > 30) throw new Error("unreadable polyline");
  }
  throw new Error("unreadable polyline");
}

function decodeSigned(encoded: string, cursor: { i: number }): number {
  const v = decodeUnsigned(encoded, cursor);
  return v & 1 ? ~(v >>> 1) : v >>> 1;
}
