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
 */
export function driveLabel(result: RouteResult): string {
  const prefix = result.source === "estimate" ? "~" : "";
  return `${prefix}${formatDriveTime(driveMinutes(result))} · ${driveMiles(result)} mi`;
}
