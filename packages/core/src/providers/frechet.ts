import { haversineMeters, type LatLng } from "./index";

/**
 * The corridor validator — pure, synchronous, network-free (docs/design/43 §4).
 *
 * HERE found a corridor that clears the rig. Google is what people actually
 * drive with, and Google knows nothing about the rig. Before we are allowed to
 * put "RV-checked" on a Google handoff, we have to prove that Google's answer
 * is the corridor HERE cleared — and that is a comparison of two TRAVERSALS,
 * not of two point sets.
 *
 * Hence discrete Fréchet rather than Hausdorff: Hausdorff would give 0 for a
 * route that drives the same corridor BACKWARDS, because every point of one is
 * on the other. Fréchet is the "dog-walking" distance — the shortest leash that
 * lets two walkers traverse both tracks front to back without going back — so
 * order is part of the answer. The test table asserts exactly that property.
 *
 * Deliberately on the providers barrel: it holds no credential and does no
 * `fetch`. The Google client that FEEDS it (google-routes.ts) is quarantined.
 */

/**
 * How far Google may wander from the HERE corridor and still be the same
 * corridor. 400 m is about the width of a highway interchange: close enough
 * that the two are the same road, far enough that lane-level geometry and two
 * vendors' snapping do not trip it. One constant, one test table.
 */
export const CORRIDOR_TOLERANCE_METERS = 400;

/**
 * The discrete Fréchet distance between two traversals, in meters.
 *
 * `Infinity` when either side is empty: an absent corridor is "not checked",
 * and it must never read as a perfect match (0).
 *
 * O(n·m) haversines with a rolling row — the corridors are a few hundred
 * vertices each, and this runs on the server beside the billable call it
 * validates, never in the client's useMemo (the client reads the cached
 * `deviationMeters` instead).
 */
export function discreteFrechet(here: LatLng[], other: LatLng[]): number {
  const n = here.length;
  const m = other.length;
  if (n === 0 || m === 0) return Infinity;

  // ca[j] = the coupling distance of here[0..i] against other[0..j].
  let prev = new Float64Array(m);
  let row = new Float64Array(m);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const d = haversineMeters(here[i]!, other[j]!);
      if (i === 0 && j === 0) row[j] = d;
      // Along either edge the coupling has no choice but to wait, so the leash
      // is the longest step so far.
      else if (i === 0) row[j] = Math.max(row[j - 1]!, d);
      else if (j === 0) row[j] = Math.max(prev[j]!, d);
      else row[j] = Math.max(Math.min(prev[j]!, prev[j - 1]!, row[j - 1]!), d);
    }
    const swap = prev;
    prev = row;
    row = swap;
  }
  return prev[m - 1]!;
}

/**
 * The one place the threshold is applied. `null` (the check never ran) and a
 * non-finite distance are both "plain" — never a pass by accident.
 */
export function withinCorridor(deviationMeters: number | null | undefined): boolean {
  if (deviationMeters === null || deviationMeters === undefined) return false;
  if (!Number.isFinite(deviationMeters)) return false;
  return deviationMeters <= CORRIDOR_TOLERANCE_METERS;
}
