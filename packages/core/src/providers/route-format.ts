import { convertMiles, distanceUnitLabel, DEFAULT_UNITS, type Units } from "../domain/units";
import type { RouteResult } from "./index";

/**
 * The strings a drive renders. They live here rather than in the web app so the
 * exact rendered text ("3h 12m · 136 mi", "~3h 02m · 141 mi") is unit-tested
 * against the fixture, and so the rail and the connector cannot disagree about
 * what a mile is.
 */

const METERS_PER_MILE = 1609.344;

export function driveMiles(result: RouteResult): number {
  return Math.round(result.distanceMeters / METERS_PER_MILE);
}

export function driveMinutes(result: RouteResult): number {
  return Math.round(result.durationSeconds / 60);
}

/** "3h 12m" · "10h 01m" · "45m". Minutes are zero-padded only beside an hour. */
export function formatDriveTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/**
 * The connector's one mono line. An estimate keeps the leading `~` — it is an
 * unfinished measurement, and the neutral "estimate" chip beside it says so.
 *
 * `units` is a DISPLAY choice applied here, at the last moment: the drive is
 * still measured and stored in miles (`driveMiles`, above), and every caller
 * that has no preference in hand gets the product default. It has to be honored
 * here rather than only at the rail, or the same screen would print "663 km" in
 * its hero and "136 mi" in every drive row beneath it.
 */
export function driveLabel(result: RouteResult, units: Units = DEFAULT_UNITS): string {
  const prefix = result.source === "estimate" ? "~" : "";
  const distance = `${convertMiles(driveMiles(result), units)} ${distanceUnitLabel(units)}`;
  return `${prefix}${formatDriveTime(driveMinutes(result))} · ${distance}`;
}
