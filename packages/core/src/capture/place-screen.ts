import type { SavedPlace } from "../domain/types";
import { shortDay } from "../domain/date-range";
import { localIsoDate } from "../planner/journal";
import type { PlaceDetails } from "../providers/index";
import { categoryOf } from "../theme/tokens";

/**
 * The phone Place screen's copy (#197 · #193, docs/design/197 §2 frames 1–4).
 * `apps/mobile` has no test runner, so every string the screen derives from a
 * save lives here, where vitest runs; the screen is layout.
 */

/** "Eat · Bellingham, WA" — the category word, then where it is. A note with
 * no area and no region is the word alone ("Eat", frame 4). */
export function placeScreenMeta(s: SavedPlace): string {
  const cat = categoryOf(s.type).cat;
  const where = s.area?.name ?? s.areaLabel ?? s.region;
  return where ? `${cat} · ${where}` : cat;
}

/**
 * The faded mono line at the foot of Yours: who the tip came from ("from Jane
 * & Rick", frame 4), or when a pin was dropped ("dropped pin · Nov 13", frame
 * 3) — the local day of `createdAt`. A Google place or a note with no source
 * has none.
 */
export function placeSourceLine(s: SavedPlace): string | null {
  if (s.source) return `from ${s.source}`;
  if (s.anchor === "pin") {
    const at = s.createdAt ? new Date(s.createdAt) : null;
    return at && !Number.isNaN(at.getTime()) ? `dropped pin · ${shortDay(localIsoDate(at))}` : "dropped pin";
  }
  return null;
}

/**
 * The accent trip link, shown when the save names a trip: "Bellingham · Nov
 * 11–15 →" once the trip's dates are known (the trips list), the name alone
 * until then.
 */
export function placeTripLine(
  s: SavedPlace,
  trip: { startDate: string; endDate: string } | null,
): string | null {
  if (!s.tripId) return null;
  const name = s.tripName ?? "Trip";
  if (!trip) return `${name} →`;
  const span =
    trip.startDate.slice(0, 7) === trip.endDate.slice(0, 7)
      ? `${shortDay(trip.startDate)}–${Number(trip.endDate.slice(8, 10))}`
      : `${shortDay(trip.startDate)}–${shortDay(trip.endDate)}`;
  return `${name} · ${span} →`;
}

/** 1284 → "1,284", without leaning on the runtime's Intl. */
function grouped(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * The phone's G line (frame 1): "G ★ 4.6 · 1,284 reviews". Google's rating,
 * mono and faded on the screen so it is never mistaken for the Sky stars in
 * Yours, which are OURS. What Google did not say is dropped.
 */
export function placeGoogleLine(d: Pick<PlaceDetails, "rating" | "userRatingCount">): string {
  const parts = ["G"];
  if (d.rating != null) parts[0] = `G ★ ${d.rating}`;
  if (d.userRatingCount != null) {
    parts.push(`${grouped(d.userRatingCount)} ${d.userRatingCount === 1 ? "review" : "reviews"}`);
  }
  return parts.join(" · ");
}

/** Call: Google's national format is for reading; `tel:` wants the digits
 * (the same rule as the web's GoogleLine). */
export function placeTelUrl(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return `tel:${digits.startsWith("+") ? digits : `+1${digits}`}`;
}
