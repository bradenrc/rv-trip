/**
 * Map geometry the clients share: a fit-bounds box over the visible points, and
 * the deterministic spiderfy that keeps co-located pins individually clickable.
 *
 * Both are pure — no vendor types, no DOM — so the web app and the native app
 * fit and offset identically, and both are unit-tested beside `derive-days`.
 */

/** A point that can actually be drawn. `lat`/`lng` on a `Place` are nullable
 * (types.ts:38-39), so every pin path narrows to this first. */
export interface MapPoint {
  lat: number;
  lng: number;
}

/** A south-west / north-east box, in the order Mapbox's `fitBounds` wants. */
export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * The smallest span a fit may produce, in degrees (~5.5km of latitude). A single
 * point — or several at the same coordinate — has zero span, and fitting a
 * zero-span box asks the map for infinite zoom. Padding to this floor keeps a
 * one-pin fit at a sane neighbourhood zoom.
 */
export const MIN_BOUNDS_SPAN = 0.05;

/** Narrowing helper: does this place have coordinates to draw? */
export function hasCoords<T extends { lat: number | null; lng: number | null }>(
  p: T,
): p is T & MapPoint {
  return p.lat !== null && p.lng !== null;
}

/**
 * The box enclosing every point, padded so a degenerate (single-point or
 * all-identical) input still produces a finite fit. `null` for no points — the
 * caller renders the "nothing to map yet" frame rather than fitting.
 */
export function boundsFor(points: readonly MapPoint[]): Bounds | null {
  if (points.length === 0) return null;

  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const p of points) {
    if (p.lng < west) west = p.lng;
    if (p.lng > east) east = p.lng;
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
  }

  const [w, e] = padSpan(west, east, -180, 180);
  const [s, n] = padSpan(south, north, -90, 90);
  return { west: w, south: s, east: e, north: n };
}

/** Grow a degenerate axis to MIN_BOUNDS_SPAN about its centre, clamped to the
 * axis' legal range so a pole/antimeridian point can't produce invalid bounds. */
function padSpan(lo: number, hi: number, min: number, max: number): [number, number] {
  if (hi - lo >= MIN_BOUNDS_SPAN) return [lo, hi];
  const mid = (lo + hi) / 2;
  const half = MIN_BOUNDS_SPAN / 2;
  return [Math.max(min, mid - half), Math.min(max, mid + half)];
}

// ── deterministic spiderfy ─────────────────────────────────────────────────
//
// The seed carries four exact coordinate collisions (a saved place sitting on
// the stop it belongs to, and one town visited on two trips). Clustering is out
// of scope, so without this the second pin of each pair is simply invisible.

/** ~26px: far enough that two 27px discs stop overlapping, close enough that
 * the leader line still reads as "these are the same spot". */
export const SPIDER_RADIUS_PX = 26;

/** Coordinates are grouped at 5 decimal places (~1.1m) — the precision the seed
 * writes, so an exact duplicate collides and a genuinely different spot does not. */
export const SPIDER_PRECISION = 5;

export interface SpiderPoint {
  id: string;
  lat: number;
  lng: number;
  /** A trip stop anchors its group: it keeps the true position and the saved
   * places sitting on it are the ones that move. */
  anchor?: boolean;
}

export interface SpiderPlacement {
  id: string;
  /** The true coordinate — the marker still hangs off this point. */
  lat: number;
  lng: number;
  /** Screen-space nudge in CSS pixels (y grows downward, as the DOM does). */
  dx: number;
  dy: number;
  /** True when this pin was moved and therefore needs a leader line. */
  spiderfied: boolean;
}

/**
 * Lay co-located points out on a ring so every one stays clickable.
 *
 * Deterministic by construction: groups are keyed on the rounded coordinate,
 * membership is ordered by `id`, and the first `anchor` (else the lowest id)
 * keeps the true position. The same input always yields the same ring, so the
 * layout never jitters between renders or between server and client.
 */
export function spiderfy(
  points: readonly SpiderPoint[],
  radiusPx: number = SPIDER_RADIUS_PX,
): SpiderPlacement[] {
  const groups = new Map<string, SpiderPoint[]>();
  for (const p of points) {
    const key = `${p.lat.toFixed(SPIDER_PRECISION)},${p.lng.toFixed(SPIDER_PRECISION)}`;
    const g = groups.get(key);
    if (g) g.push(p);
    else groups.set(key, [p]);
  }

  const byId = new Map<string, SpiderPlacement>();
  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) => a.id.localeCompare(b.id));
    if (ordered.length === 1) {
      const only = ordered[0]!;
      byId.set(only.id, { id: only.id, lat: only.lat, lng: only.lng, dx: 0, dy: 0, spiderfied: false });
      continue;
    }
    const anchorIndex = Math.max(
      0,
      ordered.findIndex((p) => p.anchor),
    );
    const anchor = ordered[anchorIndex]!;
    byId.set(anchor.id, { id: anchor.id, lat: anchor.lat, lng: anchor.lng, dx: 0, dy: 0, spiderfied: false });

    const others = ordered.filter((_, i) => i !== anchorIndex);
    others.forEach((p, i) => {
      // Start up-and-right, then even angles around the ring.
      const theta = -Math.PI / 4 + (i * 2 * Math.PI) / others.length;
      byId.set(p.id, {
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        dx: round2(radiusPx * Math.cos(theta)),
        dy: round2(radiusPx * Math.sin(theta)),
        spiderfied: true,
      });
    });
  }

  // Preserve the caller's order — the pin list drives render order (z-index).
  return points.map((p) => byId.get(p.id)!);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
