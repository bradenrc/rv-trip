import {
  deriveDays,
  isScheduled,
  type Trip,
  type Leg,
  type Stop,
  type Reservation,
  type Idea,
  type IsoDate,
  type ReservationType,
} from "@rv-trip/core";
import { dateRange, estimateDrive } from "./trip-ui";

// ── date helpers (plain UTC dates) ─────────────────────────────────────────
const MS = 86_400_000;
function addDays(d: IsoDate, n: number): IsoDate {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * MS).toISOString().slice(0, 10);
}

export function allStops(trip: Trip): Stop[] {
  return trip.legs.flatMap((l) => l.stops);
}
export function stopMap(trip: Trip): Map<string, Stop> {
  return new Map(allStops(trip).map((s) => [s.id, s]));
}

// ── Timeline (gantt) view-model ────────────────────────────────────────────
export type DayKind = "drive" | "stay" | "empty";

export interface TimelineBar {
  stopId: string;
  name: string;
  range: string;
  startCol: number;
  span: number;
  rating: number;
  resCount: number;
  ideaCount: number;
  showMeta: boolean;
}
export interface TimelineLeg {
  id: string;
  kicker: string;
  name: string;
  bars: TimelineBar[];
}
export interface TimelineGap {
  startCol: number;
  span: number;
}
export interface FloatingStop {
  id: string;
  name: string;
  note: string | null;
  ideaCount: number;
  firstIdea: string | null;
}
export interface TimelineModel {
  rhythm: { color: string; title: string }[];
  ruler: { letter: string; label: string; weekStart: boolean }[];
  legs: TimelineLeg[];
  gaps: TimelineGap[];
  openCount: number;
  gapCount: number;
  openLabel: string;
  tailHint: string;
  floating: FloatingStop[];
  allScheduled: boolean;
}

const KIND_COLOR: Record<DayKind, string> = {
  drive: "var(--color-rv-navy)",
  stay: "var(--color-rv-green)",
  empty: "var(--color-rv-navy-soft)",
};

export function timelineModel(trip: Trip): TimelineModel {
  const stops = allStops(trip);
  const byId = stopMap(trip);
  const { days, unscheduledStopIds } = deriveDays(trip, stops);

  const cols = days.map((c, i) => ({
    index: i + 1,
    date: c.date,
    kind: c.kind as DayKind,
    stopId: c.kind === "stay" ? c.stopId! : c.kind === "drive" ? c.toStopId! : null,
  }));

  const rhythm = cols.map((c) => {
    const stop = c.stopId ? byId.get(c.stopId) : null;
    const title =
      c.kind === "drive"
        ? `Drive → ${stop?.place.name ?? ""}`
        : c.kind === "stay"
          ? `Stay · ${stop?.place.name ?? ""}`
          : "Open";
    return { color: KIND_COLOR[c.kind], title: `${c.date} — ${title}` };
  });

  const ruler = cols.map((c, i) => {
    const day = Number(c.date.slice(8));
    const weekStart = i % 7 === 0;
    return {
      letter: weekdayLetter(c.date),
      label: weekStart ? `${monthAbbr(c.date)} ${day}` : String(day),
      weekStart: weekStart && i > 0,
    };
  });

  // contiguous same-stop runs → segments
  const segments: { stopId: string; startCol: number; span: number }[] = [];
  cols.forEach((c, i) => {
    if (!c.stopId) return;
    const prev = cols[i - 1];
    if (prev && prev.stopId === c.stopId) segments[segments.length - 1]!.span++;
    else segments.push({ stopId: c.stopId, startCol: c.index, span: 1 });
  });

  const legs: TimelineLeg[] = trip.legs.map((leg, i) => ({
    id: leg.id,
    kicker: `Leg ${i + 1}`,
    name: leg.title,
    bars: segments
      .filter((s) => byId.get(s.stopId)?.legId === leg.id)
      .map((s) => {
        const stop = byId.get(s.stopId)!;
        const resCount = stop.reservations.length;
        const ideaCount = stop.ideas.length;
        const rating = stop.rating ?? 0;
        return {
          stopId: s.stopId,
          name: stop.place.name,
          range: isScheduled(stop)
            ? dateRange(stop.arriveDate, stop.departDate)
            : "",
          startCol: s.startCol,
          span: s.span,
          rating,
          resCount,
          ideaCount,
          showMeta: rating > 0 || resCount > 0 || ideaCount > 0,
        };
      }),
  }));

  // contiguous open runs → gaps
  const gaps: TimelineGap[] = [];
  cols.forEach((c, i) => {
    if (c.kind !== "empty") return;
    const prev = cols[i - 1];
    if (prev && prev.kind === "empty") gaps[gaps.length - 1]!.span++;
    else gaps.push({ startCol: c.index, span: 1 });
  });

  const openCount = cols.filter((c) => c.kind === "empty").length;
  const gapCount = gaps.length;
  const openLabel =
    openCount === 0
      ? "Every day planned"
      : `${openCount} open day${openCount === 1 ? "" : "s"} across ${gapCount} gap${gapCount === 1 ? "" : "s"}`;

  // trailing open run
  let tail = 0;
  for (let j = cols.length - 1; j >= 0 && cols[j]!.kind === "empty"; j--) tail++;
  const lastScheduled = [...segments].reverse()[0];
  const lastName = lastScheduled ? byId.get(lastScheduled.stopId)?.place.name : null;

  const floating: FloatingStop[] = unscheduledStopIds
    .map((id) => byId.get(id)!)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => ({
      id: s.id,
      name: s.place.name,
      note: s.notes,
      ideaCount: s.ideas.length,
      firstIdea: s.ideas[0]?.title ?? null,
    }));

  const tailHint =
    tail > 2 && lastName && floating[0]
      ? `${tail} open days sit after ${lastName} — drag ${floating[0].name} onto that span to fill the tail.`
      : "Drop it on any open span to give it dates.";

  return {
    rhythm,
    ruler,
    legs,
    gaps,
    openCount,
    gapCount,
    openLabel,
    tailHint,
    floating,
    allScheduled: floating.length === 0,
  };
}

// ── Route view-model ───────────────────────────────────────────────────────
export interface RouteReservation {
  id: string;
  name: string;
  type: ReservationType;
  cost: number | null;
  dates: string | null;
}
export interface RouteIdea {
  id: string;
  title: string;
  type: ReservationType;
  status: Idea["status"];
}
export interface RouteRow {
  stop: Stop;
  dates: string | null;
  floating: boolean;
  rating: number;
  note: string | null;
  reservations: RouteReservation[];
  ideas: RouteIdea[];
  showIdeaDivider: boolean;
  driveLabel: string | null;
}
export interface RouteLeg {
  id: string;
  kicker: string;
  name: string;
  rows: RouteRow[];
}

export function routeModel(trip: Trip): RouteLeg[] {
  return trip.legs.map((leg, i) => {
    const scheduled = leg.stops
      .filter(isScheduled)
      .sort((a, b) => a.arriveDate!.localeCompare(b.arriveDate!));
    const floats = leg.stops
      .filter((s) => !isScheduled(s))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const ordered = [...scheduled, ...floats];

    const rows: RouteRow[] = ordered.map((stop, idx) => {
      const next = ordered[idx + 1];
      const drive =
        next && isScheduled(stop) && isScheduled(next)
          ? estimateDrive(stop.place, next.place)
          : null;
      return {
        stop,
        dates: isScheduled(stop) ? dateRange(stop.arriveDate, stop.departDate) : null,
        floating: !isScheduled(stop),
        rating: stop.rating ?? 0,
        note: stop.notes,
        reservations: stop.reservations.map((r) => ({
          id: r.id,
          name: r.name,
          type: r.type,
          cost: r.cost,
          dates: resDates(r),
        })),
        ideas: stop.ideas.map((it) => ({
          id: it.id,
          title: it.title,
          type: "activity" as ReservationType,
          status: it.status,
        })),
        showIdeaDivider: stop.reservations.length > 0 && stop.ideas.length > 0,
        driveLabel: drive?.label ?? null,
      };
    });

    return { id: leg.id, kicker: `Leg ${i + 1}`, name: leg.title, rows };
  });
}

export function resDates(r: Reservation): string | null {
  if (r.checkIn && r.checkOut) return dateRange(r.checkIn, r.checkOut);
  if (r.checkIn) return dateRange(r.checkIn, r.checkIn);
  return null;
}

// ── mutations (pure; return a new Trip) ────────────────────────────────────
function mapLegs(trip: Trip, fn: (l: Leg) => Leg): Trip {
  return { ...trip, legs: trip.legs.map(fn) };
}
export function updateStop(trip: Trip, stopId: string, patch: (s: Stop) => Stop): Trip {
  return mapLegs(trip, (l) => ({
    ...l,
    stops: l.stops.map((s) => (s.id === stopId ? patch(s) : s)),
  }));
}
export function setStopRating(trip: Trip, stopId: string, rating: number): Trip {
  return updateStop(trip, stopId, (s) => ({ ...s, rating: rating === 0 ? null : rating }));
}
export function setStopNote(trip: Trip, stopId: string, note: string): Trip {
  return updateStop(trip, stopId, (s) => ({ ...s, notes: note }));
}
export function setReservationRating(trip: Trip, stopId: string, resId: string, rating: number): Trip {
  return updateStop(trip, stopId, (s) => ({
    ...s,
    reservations: s.reservations.map((r) =>
      r.id === resId ? { ...r, rating: r.rating === rating ? null : rating || null } : r,
    ),
  }));
}
export function setReservationNote(trip: Trip, stopId: string, resId: string, notes: string): Trip {
  return updateStop(trip, stopId, (s) => ({
    ...s,
    reservations: s.reservations.map((r) => (r.id === resId ? { ...r, notes } : r)),
  }));
}
export function addReservation(
  trip: Trip,
  stopId: string,
  input: { type: ReservationType; name: string; cost: number | null; checkIn: IsoDate | null },
): Trip {
  return updateStop(trip, stopId, (s) => ({
    ...s,
    reservations: [
      ...s.reservations,
      {
        id: crypto.randomUUID(),
        stopId,
        ideaId: null,
        type: input.type,
        name: input.name,
        checkIn: input.checkIn,
        checkOut: null,
        confirmationNumber: null,
        cost: input.cost,
        rating: null,
        notes: null,
      },
    ],
  }));
}
export function cycleIdeaStatus(trip: Trip, stopId: string, ideaId: string): Trip {
  const order: Idea["status"][] = ["idea", "planned", "done"];
  return updateStop(trip, stopId, (s) => ({
    ...s,
    ideas: s.ideas.map((it) =>
      it.id === ideaId
        ? { ...it, status: order[(order.indexOf(it.status) + 1) % 3]! }
        : it,
    ),
  }));
}
export function setIdeaRating(trip: Trip, stopId: string, ideaId: string, rating: number): Trip {
  return updateStop(trip, stopId, (s) => ({
    ...s,
    ideas: s.ideas.map((it) =>
      it.id === ideaId ? { ...it, rating: it.rating === rating ? null : rating || null } : it,
    ),
  }));
}
export function setIdeaNote(trip: Trip, stopId: string, ideaId: string, notes: string): Trip {
  return updateStop(trip, stopId, (s) => ({
    ...s,
    ideas: s.ideas.map((it) => (it.id === ideaId ? { ...it, notes } : it)),
  }));
}
export function promoteIdea(trip: Trip, stopId: string, ideaId: string): Trip {
  return updateStop(trip, stopId, (s) => {
    const idea = s.ideas.find((it) => it.id === ideaId);
    if (!idea) return s;
    return {
      ...s,
      ideas: s.ideas.filter((it) => it.id !== ideaId),
      reservations: [
        ...s.reservations,
        {
          id: crypto.randomUUID(),
          stopId,
          ideaId: null,
          type: "activity",
          name: idea.title,
          checkIn: null,
          checkOut: null,
          confirmationNumber: null,
          cost: null,
          rating: null,
          notes: "Promoted from idea",
        },
      ],
    };
  });
}

/** Assign dates to a floating stop by dropping it into the largest open run. */
export function scheduleFloating(trip: Trip, stopId: string, nights = 3): Trip {
  const stops = allStops(trip);
  const { days } = deriveDays(trip, stops);
  let best = -1,
    bestLen = 0,
    cur = -1,
    curLen = 0;
  days.forEach((d, i) => {
    if (d.kind === "empty") {
      if (curLen === 0) cur = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        best = cur;
      }
    } else curLen = 0;
  });
  if (best < 0) return trip;
  const span = Math.min(nights, bestLen);
  const arriveDate = days[best]!.date;
  const departDate = addDays(arriveDate, span - 1);
  return updateStop(trip, stopId, (s) => ({ ...s, arriveDate, departDate }));
}

/** Reorder a floating stop within its leg (dragged before target). */
export function reorderFloating(
  trip: Trip,
  legId: string,
  draggedId: string,
  targetId: string,
): Trip {
  if (draggedId === targetId) return trip;
  return mapLegs(trip, (l) => {
    if (l.id !== legId) return l;
    const scheduled = l.stops
      .filter(isScheduled)
      .sort((a, b) => a.arriveDate!.localeCompare(b.arriveDate!));
    const floats = l.stops
      .filter((s) => !isScheduled(s))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const from = floats.findIndex((s) => s.id === draggedId);
    const to = floats.findIndex((s) => s.id === targetId);
    if (from < 0 || to < 0) return l;
    const [moved] = floats.splice(from, 1);
    floats.splice(to, 0, moved!);
    const orderedIds = [...scheduled, ...floats].map((s) => s.id);
    return {
      ...l,
      stops: l.stops.map((s) => ({ ...s, sortOrder: orderedIds.indexOf(s.id) })),
    };
  });
}

// local date-part helpers (avoid importing all of trip-ui into logic)
const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["S", "M", "T", "W", "T", "F", "S"];
function monthAbbr(d: IsoDate): string {
  return M[Number(d.slice(5, 7)) - 1]!;
}
function weekdayLetter(d: IsoDate): string {
  return WD[new Date(`${d}T00:00:00Z`).getUTCDay()]!;
}
