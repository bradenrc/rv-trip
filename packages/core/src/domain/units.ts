/**
 * Display units (docs/design/45 §"Units — the whole blast radius", issue #38).
 *
 * Core keeps COMPUTING in miles — `driveMiles`, `TripArc.miles`,
 * `RouteSummary.driveMiles` and `TripSummary.miles` are all miles, and none of
 * them changes. This is a conversion at the EDGE, applied where a number is
 * printed, not a change to the planner's types.
 *
 * Two functions rather than one formatted string, deliberately: the Route
 * rail draws the number at 34px and the unit at 15px in two separately-styled
 * spans, so a single `"663 km"` would have to be split back apart.
 *
 * The rig is the one surface that needs no conversion at all — `rig.ts` already
 * stores metres and kilograms at millimetre precision, so metric mode there is
 * the stored value shown as-is.
 */

export const UNITS = ["imperial", "metric"] as const;

export type Units = (typeof UNITS)[number];

/** The product default, and what every surface renders when nothing is chosen. */
export const DEFAULT_UNITS: Units = "imperial";

/** Narrow an untrusted string — a persisted preference, a stale value written
 * by a future release — to a vocabulary this build can actually print. */
export function isUnits(value: string): value is Units {
  return (UNITS as readonly string[]).includes(value);
}

const KM_PER_MILE = 1.609344;

/**
 * A mile count as the chosen vocabulary prints it: miles unchanged, or whole
 * kilometres. Whole, because every caller is a glanceable total — a rail hero,
 * a dashboard chip, a map label — and none of them has room for a decimal.
 */
export function convertMiles(miles: number, units: Units): number {
  return units === "metric" ? Math.round(miles * KM_PER_MILE) : miles;
}

/** The unit's own short label, for the span beside the number. */
export function distanceUnitLabel(units: Units): "mi" | "km" {
  return units === "metric" ? "km" : "mi";
}
