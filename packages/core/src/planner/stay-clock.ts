import type { Reservation } from "../domain/types";

/**
 * #162 · Q3 A — a stay's check-in / check-out times, as the Itinerary's stay
 * row prints them under the `ReservationLineItem`:
 *
 *     in after 4:00 PM · out by 11:00 AM
 *
 * 12-hour, in the row's OWN zone (`startsTz` / `endsTz`) — the hotel's wall
 * clock, wherever the reader is. Deliberately not the flight `OkLine`'s
 * 24-hour "19:30 CST": a check-in is read off a confirmation email, and that is
 * how the email says it. A stay with neither instant draws no line (null);
 * with only one, only that half.
 */
export function stayClockLine(
  r: Pick<Reservation, "startsAt" | "startsTz" | "endsAt" | "endsTz">,
): string | null {
  const parts = [
    r.startsAt ? `in after ${wallClock12(r.startsAt, r.startsTz)}` : null,
    r.endsAt ? `out by ${wallClock12(r.endsAt, r.endsTz)}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** "4:00 PM" — assembled from parts, because ICU joins the day period with a
 * narrow no-break space (U+202F) that would make two renders disagree. */
function wallClock12(instant: string, tz: string | null): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz ?? "UTC",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const p = fmt.formatToParts(new Date(instant));
  const get = (t: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`;
}
