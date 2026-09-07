import {
  deriveDays,
  isScheduled,
  orderedLegStops,
  orderedPairs,
  routeCacheKey,
  estimateRoute,
  driveLabel,
  driveMiles,
  driveMinutes,
  formatDriveTime,
  buildNavigationHandoff,
  NO_RIG_HASH,
  type Trip,
  type Leg,
  type Stop,
  type Reservation,
  type Idea,
  type IsoDate,
  type ReservationType,
  type OrderedPair,
  type RouteResult,
  type RouteNotice,
} from "@rv-trip/core";
import { dateRange } from "./trip-ui";

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
  /** The drive OUT of this stop, when the next stop is in the same leg. */
  drive: RouteDrive | null;
}
export interface RouteLeg {
  id: string;
  kicker: string;
  name: string;
  rows: RouteRow[];
  /** The drive that crosses out of this leg — drawn after the rows, under a
   * hairline seam, so it reads as a crossing rather than an orphan row (G1). */
  outboundDrive: RouteDrive | null;
  /** "Leg 1 → Leg 2" */
  outboundSeam: string | null;
}

/**
 * The server-resolved routes, keyed by `from|to|rigHash` — a map, never a
 * positional array, so it crosses the RSC boundary and survives client-side
 * reordering. A key MISS (you dragged a floating stop and invented a pair the
 * server never routed) falls straight to the synchronous estimate: no spinner,
 * no layout jump, no blocked save.
 */
export type RouteMap = Record<string, RouteResult>;

/** One drive, as the connector and the rail both need it. */
export interface RouteDrive {
  key: string;
  /** "3h 12m · 136 mi", or "~3h 02m · 141 mi" when it is only an estimate. */
  label: string;
  /** An unfinished measurement, not a warning — neutral chip, never amber. */
  estimate: boolean;
  primaryRoad: string | null;
  notices: RouteNotice[];
  /** Google Maps deep link — origin and destination only, never the corridor.
   * See buildNavigationHandoff: the notices are what carry the RV-safe caveat. */
  navUrl: string;
  miles: number;
  minutes: number;
}

function toDrive(pair: OrderedPair, routes: RouteMap, rigHash: string): RouteDrive {
  const key = routeCacheKey(pair.from, pair.to, rigHash);
  const result = routes[key] ?? estimateRoute(pair.from, pair.to);
  // Endpoints only. Google cannot be handed a pass-through waypoint, so the
  // link is honestly "get me there", and the notices below it are what says
  // the RV-safe corridor may not be what Google picks.
  const handoff = buildNavigationHandoff(pair.from, pair.to);
  return {
    key,
    label: driveLabel(result),
    estimate: result.source === "estimate",
    primaryRoad: result.primaryRoad,
    notices: result.notices,
    navUrl: handoff.url,
    miles: driveMiles(result),
    minutes: driveMinutes(result),
  };
}

/**
 * Every drive on the trip, resolved once and indexed the two ways the screen
 * needs it. The rail and the connectors read the SAME list, which is what makes
 * the rail exactly the sum of the drives you can see.
 */
function resolveDrives(trip: Trip, routes: RouteMap, rigHash: string) {
  const byFromStop = new Map<string, RouteDrive>();
  // Keyed by the leg the drive leaves, but it carries the leg it ARRIVES in:
  // an emptied leg in between means the crossing is not always i → i + 1.
  const boundaryByLeg = new Map<string, { drive: RouteDrive; toLegId: string }>();
  const all: RouteDrive[] = [];
  for (const pair of orderedPairs(trip)) {
    const drive = toDrive(pair, routes, rigHash);
    all.push(drive);
    if (pair.legBoundary) boundaryByLeg.set(pair.fromLegId, { drive, toLegId: pair.toLegId });
    else byFromStop.set(pair.fromStopId, drive);
  }
  return { byFromStop, boundaryByLeg, all };
}

export function routeModel(
  trip: Trip,
  routes: RouteMap = {},
  rigHash: string = NO_RIG_HASH,
): RouteLeg[] {
  const { byFromStop, boundaryByLeg } = resolveDrives(trip, routes, rigHash);
  const legs = [...trip.legs].sort((a, b) => a.sortOrder - b.sortOrder);
  const legNumber = new Map(legs.map((l, i) => [l.id, i + 1]));

  return legs.map((leg, i) => {
    const ordered = orderedLegStops(leg.stops);

    const rows: RouteRow[] = ordered.map((stop) => ({
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
      drive: byFromStop.get(stop.id) ?? null,
    }));

    const boundary = boundaryByLeg.get(leg.id) ?? null;
    return {
      id: leg.id,
      kicker: `Leg ${i + 1}`,
      name: leg.title,
      rows,
      outboundDrive: boundary?.drive ?? null,
      outboundSeam: boundary
        ? `Leg ${i + 1} → Leg ${legNumber.get(boundary.toLegId) ?? i + 2}`
        : null,
    };
  });
}

export function resDates(r: Reservation): string | null {
  if (r.checkIn && r.checkOut) return dateRange(r.checkIn, r.checkOut);
  if (r.checkIn) return dateRange(r.checkIn, r.checkIn);
  return null;
}

// ── Route summary rail view-model ──────────────────────────────────────────
export interface RouteSummary {
  driveMiles: number;
  driveTime: string;
  /** How many amber notices the whole route carries. Rendered only when > 0 —
   * a permanent "0 restrictions" would train the eye to skip the slot. */
  restrictionCount: number;
  totalCost: number;
  stops: number;
  scheduled: number;
  floating: number;
  days: number;
  openCount: number;
  gapCount: number;
  legs: { id: string; name: string; stops: number; cost: number }[];
}

export function routeSummary(
  trip: Trip,
  routes: RouteMap = {},
  rigHash: string = NO_RIG_HASH,
): RouteSummary {
  const stops = allStops(trip);
  const stopCost = (s: Stop) => s.reservations.reduce((x, r) => x + (r.cost ?? 0), 0);
  const { days } = deriveDays(trip, stops);
  const openCount = days.filter((d) => d.kind === "empty").length;
  let gapCount = 0;
  days.forEach((d, i) => {
    if (d.kind === "empty" && (i === 0 || days[i - 1]!.kind !== "empty")) gapCount++;
  });

  // The SAME drives the connectors render — including the leg-boundary drive
  // and the floating one. The rail used to sum trip-wide scheduled pairs while
  // the screen drew per-leg ones, so the two had never agreed (G1/G2).
  const { all } = resolveDrives(trip, routes, rigHash);
  const driveMilesTotal = all.reduce((a, d) => a + d.miles, 0);
  const driveMins = all.reduce((a, d) => a + d.minutes, 0);

  return {
    driveMiles: driveMilesTotal,
    driveTime: driveMilesTotal ? formatDriveTime(driveMins) : "—",
    restrictionCount: all.reduce((a, d) => a + d.notices.length, 0),
    totalCost: stops.reduce((a, s) => a + stopCost(s), 0),
    stops: stops.length,
    scheduled: stops.filter(isScheduled).length,
    floating: stops.filter((s) => !isScheduled(s)).length,
    days: days.length,
    openCount,
    gapCount,
    legs: [...trip.legs]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((l) => ({
        id: l.id,
        name: l.title,
        stops: l.stops.length,
        cost: l.stops.reduce((a, s) => a + stopCost(s), 0),
      })),
  };
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
