import { haversineMeters, type LatLng } from "./index";

/**
 * The Google Maps handoff (docs/design/9 §6).
 *
 * HERE found a corridor that clears our rig; Google is the thing people
 * actually drive with. Pinning waypoints along the safe corridor is how we ask
 * Google to keep to it — but Google will happily reroute a driver who deviates,
 * and it does not know our clearance, so this is guidance, never a guarantee.
 * That is why the in-app notices do NOT dismiss on handoff.
 *
 * Pure and network-free, so the waypoint-selection rules are unit-testable.
 */

/** Google's `waypoints=` limit on a `dir/?api=1` deep link. */
export const MAX_GOOGLE_WAYPOINTS = 9;

/** Two pins closer together than this add nothing but URL length. ~2 mi. */
export const MIN_WAYPOINT_SEPARATION_METERS = 3218;

/** Below this the two routes are the same road; there is nothing to pin. */
const MIN_DIVERGENCE_METERS = 1;

export interface NavigationHandoff {
  url: string;
  waypoints: LatLng[];
}

export function buildNavigationHandoff(input: {
  from: LatLng;
  to: LatLng;
  /** The corridor HERE routed for the rig. */
  safePath?: LatLng[] | null;
  /** What a car would have driven. No naive path → nothing to compare against. */
  naivePath?: LatLng[] | null;
}): NavigationHandoff {
  const waypoints = selectWaypoints(input.safePath, input.naivePath);
  return { url: mapsUrl(input.from, input.to, waypoints), waypoints };
}

function selectWaypoints(
  safePath: LatLng[] | null | undefined,
  naivePath: LatLng[] | null | undefined,
): LatLng[] {
  if (!safePath || !naivePath || safePath.length < 3 || naivePath.length === 0) return [];

  // Interior points only — the endpoints are already origin and destination.
  const candidates = safePath
    .slice(1, -1)
    .map((point, i) => ({ point, index: i + 1, divergence: nearestDistance(point, naivePath) }))
    .filter((c) => c.divergence > MIN_DIVERGENCE_METERS)
    .sort((a, b) => b.divergence - a.divergence);

  const chosen: { point: LatLng; index: number }[] = [];
  const anchors = [safePath[0]!, safePath[safePath.length - 1]!];
  for (const candidate of candidates) {
    if (chosen.length >= MAX_GOOGLE_WAYPOINTS) break;
    const tooClose = [...anchors, ...chosen.map((c) => c.point)].some(
      (p) => haversineMeters(p, candidate.point) < MIN_WAYPOINT_SEPARATION_METERS,
    );
    if (!tooClose) chosen.push({ point: candidate.point, index: candidate.index });
  }

  // Google follows the order given, so hand them over in travel order.
  return chosen.sort((a, b) => a.index - b.index).map((c) => c.point);
}

function nearestDistance(point: LatLng, path: LatLng[]): number {
  let best = Infinity;
  for (const p of path) {
    const d = haversineMeters(point, p);
    if (d < best) best = d;
  }
  return best;
}

function coord(p: LatLng): string {
  return `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
}

function mapsUrl(from: LatLng, to: LatLng, waypoints: LatLng[]): string {
  const parts = [
    "https://www.google.com/maps/dir/?api=1",
    `origin=${coord(from)}`,
    `destination=${coord(to)}`,
  ];
  if (waypoints.length > 0) parts.push(`waypoints=${waypoints.map(coord).join("|")}`);
  parts.push("travelmode=driving");
  return parts.join("&");
}
