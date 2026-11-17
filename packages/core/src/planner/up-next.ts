import type { Destination, IsoDate, Reservation, Segment, Trip } from "../domain/types";
import { isScheduled } from "../domain/types";
import { segmentDates } from "../domain/derive-days";
import { hasCoords } from "../domain/bounds";
import { categoryOf } from "../theme/tokens";
import { isoDateInZone } from "./journal";
import { weekdayMonthDay } from "./dates";
import { wallClock12 } from "./stay-clock";

/**
 * Up next (#178 · #181 i3 · q3 B · q4 B): the one thing the trip asks of you
 * now, plus the hop that follows it on the same day. A pure function of the
 * trip and the clock. The Journal's Today block on both clients reads it, so
 * the phone and the web cannot disagree about what is next.
 *
 * The items:
 *   - every Stay-category reservation on a SCHEDULED destination gives a
 *     check-in (`startsAt`/`startsTz`, else its `checkIn` date, untimed) and a
 *     check-out (`endsAt`/`endsTz`, else its `checkOut` date, untimed);
 *   - any other destination reservation with a `startsAt` is a "booking";
 *   - every segment is a hop (drive · fly · ferry by mode), timed by its own
 *     `departAt`/`departTz` or its reservation's `startsAt`/`startsTz`; an
 *     untimed hop takes its day from derive-days' `segmentDates`.
 *
 * Order: by local date, then by instant. Within one date an untimed check-out
 * opens the day, an untimed hop sits right after that date's last check-out,
 * and an untimed check-in closes the day.
 *
 * Passed: a timed item whose instant is <= now, or any item whose date is
 * before today. `next` is the item after the last passed one; `then` is the
 * item after `next` only when it is a hop on `next`'s date.
 */

export type UpNextKind = "check-out" | "check-in" | "booking" | "drive" | "fly" | "ferry";

export interface UpNextItem {
  kind: UpNextKind;
  title: string;
  /** "TODAY · OUT BY 11:00 AM", "SUN AUG 9", "TODAY · 6:10 PM PST". */
  when: string;
  /** The local date in the item's own zone. */
  date: IsoDate;
  /** `date === today`. */
  sameDay: boolean;
  /** The hop's segment; null for a stay or a booking. */
  segmentId: string | null;
  /** Where a drive arrives (Google · Apple · Waze); null otherwise. */
  navTo: { lat: number; lng: number } | null;
}

/** A collected item before `when`/`sameDay` are known. */
interface Raw {
  kind: UpNextKind;
  title: string;
  date: IsoDate;
  /** Epoch ms when timed; null when untimed. */
  ms: number | null;
  /** The clock label after the day: "OUT BY 11:00 AM", "6:10 PM PST"; null when untimed. */
  clock: string | null;
  segmentId: string | null;
  navTo: { lat: number; lng: number } | null;
}

const HOPS = new Set<UpNextKind>(["drive", "fly", "ferry"]);
const isHop = (k: UpNextKind) => HOPS.has(k);

/** The local date an instant falls on in its own zone (a null zone reads UTC). */
function dateOf(instant: string, tz: string | null): IsoDate {
  return isoDateInZone(new Date(instant), tz ?? "UTC") ?? new Date(instant).toISOString().slice(0, 10);
}

/** "PST" — the zone's short name at that instant (en-US). */
function zoneAbbr(instant: string, tz: string | null): string {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz ?? "UTC", timeZoneName: "short" }).formatToParts(
    new Date(instant),
  );
  return p.find((x) => x.type === "timeZoneName")?.value ?? "";
}

/** "TODAY", else "SUN AUG 9". */
function dayLabel(date: IsoDate, today: IsoDate): string {
  return date === today ? "TODAY" : weekdayMonthDay(date).toUpperCase();
}

const isStay = (r: Reservation) => categoryOf(r.type).cat === "Stay";

function stayItems(d: Destination & { arriveDate: IsoDate; departDate: IsoDate }, r: Reservation): Raw[] {
  const base = { segmentId: null, navTo: null };
  const checkIn: Raw = r.startsAt
    ? {
        ...base,
        kind: "check-in",
        title: `Check in at ${r.name}`,
        date: dateOf(r.startsAt, r.startsTz),
        ms: Date.parse(r.startsAt),
        clock: `IN AFTER ${wallClock12(r.startsAt, r.startsTz)}`,
      }
    : { ...base, kind: "check-in", title: `Check in at ${r.name}`, date: r.checkIn ?? d.arriveDate, ms: null, clock: null };
  const checkOut: Raw = r.endsAt
    ? {
        ...base,
        kind: "check-out",
        title: `Check out of ${r.name}`,
        date: dateOf(r.endsAt, r.endsTz),
        ms: Date.parse(r.endsAt),
        clock: `OUT BY ${wallClock12(r.endsAt, r.endsTz)}`,
      }
    : { ...base, kind: "check-out", title: `Check out of ${r.name}`, date: r.checkOut ?? d.departDate, ms: null, clock: null };
  return [checkIn, checkOut];
}

function hopItem(trip: Trip, seg: Segment, byId: Map<string, Destination>): Raw | null {
  const to = seg.toDestinationId !== null ? byId.get(seg.toDestinationId) ?? null : null;
  const toName = to?.place.name ?? trip.homeBase ?? "home";
  const booking = seg.reservations.find((r) => r.startsAt !== null) ?? seg.reservations[0] ?? null;

  let title: string;
  if (seg.mode === "drive") title = `Drive to ${toName}`;
  else {
    const verb = seg.mode === "fly" ? "Fly" : "Ferry";
    title = booking ? `${verb} ${booking.name}` : `${verb} to ${toName}`;
  }

  const navTo = seg.mode === "drive" && to && hasCoords(to.place) ? { lat: to.place.lat, lng: to.place.lng } : null;
  const base = { kind: seg.mode, title, segmentId: seg.id, navTo } as const;

  const instant = seg.departAt ?? booking?.startsAt ?? null;
  const tz = seg.departAt ? seg.departTz : (booking?.startsTz ?? null);
  if (instant) {
    const clock = `${wallClock12(instant, tz)} ${zoneAbbr(instant, tz)}`.trim();
    return { ...base, date: dateOf(instant, tz), ms: Date.parse(instant), clock };
  }
  const [date] = segmentDates(seg, byId);
  return date ? { ...base, date, ms: null, clock: null } : null;
}

/** Every item, in order (see the module doc). */
function upNextItems(trip: Trip): Raw[] {
  const destinations = trip.chapters.flatMap((c) => c.destinations);
  const byId = new Map(destinations.map((d) => [d.id, d]));
  const fixed: Raw[] = [];
  const untimedHops: Raw[] = [];

  for (const d of destinations) {
    if (!isScheduled(d)) continue;
    for (const r of d.reservations) {
      if (isStay(r)) fixed.push(...stayItems(d, r));
      else if (r.startsAt) {
        fixed.push({
          kind: "booking",
          title: r.name,
          date: dateOf(r.startsAt, r.startsTz),
          ms: Date.parse(r.startsAt),
          clock: wallClock12(r.startsAt, r.startsTz),
          segmentId: null,
          navTo: null,
        });
      }
    }
  }
  for (const seg of [...trip.segments].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const item = hopItem(trip, seg, byId);
    if (!item) continue;
    (item.ms === null ? untimedHops : fixed).push(item);
  }

  // Within a date: untimed check-out first, timed by instant, untimed check-in last.
  const slot = (x: Raw) => (x.ms !== null ? 1 : x.kind === "check-out" ? 0 : 2);
  fixed.sort(
    (a, b) => a.date.localeCompare(b.date) || slot(a) - slot(b) || (a.ms ?? 0) - (b.ms ?? 0),
  );

  // An untimed hop goes right after its date's last check-out; with none, it
  // opens its date (after anything on an earlier date). Array order (sortOrder)
  // breaks ties between hops on one date.
  const out = [...fixed];
  for (const hop of untimedHops) {
    let at = -1;
    for (let i = 0; i < out.length; i++) {
      const x = out[i]!;
      if (x.date < hop.date) at = i;
      else if (x.date === hop.date && (x.kind === "check-out" || (isHop(x.kind) && x.ms === null))) at = i;
    }
    out.splice(at + 1, 0, hop);
  }
  return out;
}

export function upNext(
  trip: Trip,
  now: Date,
  today: IsoDate,
): { next: UpNextItem; then: UpNextItem | null } | null {
  const items = upNextItems(trip);
  const nowMs = now.getTime();
  let last = -1;
  items.forEach((x, i) => {
    if (x.date < today || (x.ms !== null && x.ms <= nowMs)) last = i;
  });
  const n = items[last + 1];
  if (!n) return null;
  const after = items[last + 2];
  const view = (x: Raw): UpNextItem => ({
    kind: x.kind,
    title: x.title,
    when: x.clock ? `${dayLabel(x.date, today)} · ${x.clock}` : dayLabel(x.date, today),
    date: x.date,
    sameDay: x.date === today,
    segmentId: x.segmentId,
    navTo: x.navTo,
  });
  return {
    next: view(n),
    then: after && isHop(after.kind) && after.date === n.date ? view(after) : null,
  };
}
