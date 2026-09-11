import { deriveDays, type DayKind } from "../domain/derive-days";
import {
  isScheduled,
  type Trip,
  type Leg,
  type Stop,
  type Reservation,
  type ReservationPatchInput,
  type Idea,
  type IsoDate,
  type ReservationType,
} from "../domain/types";
import { orderedLegStops, orderedPairs, routeCacheKey, type OrderedPair } from "../domain/route-order";
import { NO_ROUTING_HASH } from "../domain/rig";
import { estimateRoute, type RouteResult, type RouteNotice } from "../providers/index";
import { driveLabel, driveMiles, driveMinutes, formatDriveTime } from "../providers/route-format";
import {
  buildNavigationHandoff,
  type NavCheck,
  type NavigationVerdict,
} from "../providers/navigation";
import { dateRange, monthAbbr, weekdayLetter, addDays } from "./dates";

/**
 * The planner's view-models and pure mutations — ONE model for the Timeline
 * and Route lenses, shared by the web app and the native app.
 *
 * Moved verbatim from apps/web/src/lib/trip-logic.ts (C0, issue #31; audit
 * §3 G2). Everything here is a pure function of a Trip (+ the server-resolved
 * RouteMap); nothing imports a framework. The web's `@/lib/trip-logic` is now
 * a re-export of this module.
 */

export * from "./dates";

export function allStops(trip: Trip): Stop[] {
  return trip.legs.flatMap((l) => l.stops);
}
export function stopMap(trip: Trip): Map<string, Stop> {
  return new Map(allStops(trip).map((s) => [s.id, s]));
}

// ── Timeline (gantt) view-model ────────────────────────────────────────────

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
  rhythm: { kind: DayKind; color: string; title: string }[];
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

/** The web paints the rhythm strip with these CSS variables; the native app
 * reads `kind` instead. Both are carried so neither client re-derives it. */
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
    return { kind: c.kind, color: KIND_COLOR[c.kind], title: `${c.date} — ${title}` };
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
 * The server-resolved routes, keyed by `from|to|routingHash` — a map, never a
 * positional array, so it crosses the RSC boundary and survives client-side
 * reordering. A key MISS (you dragged a floating stop and invented a pair the
 * server never routed) falls straight to the synchronous estimate: no spinner,
 * no layout jump, no blocked save.
 */
export type RouteMap = Record<string, RouteResult>;

/**
 * The server-resolved corridor checks, keyed exactly as `RouteMap` is
 * (docs/design/43 §4). Separate from `RouteMap` because the cached row keeps
 * `result` a verbatim RouteResult — the check lives in its own `nav` column —
 * and because resolving it is BILLABLE and therefore opt-in per caller: the
 * trip page asks for it, /map does not.
 *
 * A missing key is the normal case (no Google key, an un-checked drive, or a
 * pair the client just invented by dragging): verdict "plain", no spinner.
 */
export type NavMap = Record<string, NavCheck>;

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
  /** HERE WeGo deep link — the corridor's own vendor, the alternative on the
   * split Navigate control. */
  navWegoUrl: string;
  /** Whether Google's own answer for these two endpoints was held against the
   * HERE corridor and matched it. "plain" whenever we do not know. */
  navVerdict: NavigationVerdict;
  /** How far Google's route ran from the corridor, in meters — `null` when the
   * check never ran. */
  navDeviationMeters: number | null;
  miles: number;
  minutes: number;
}

function toDrive(
  pair: OrderedPair,
  routes: RouteMap,
  routingHash: string,
  nav: NavMap,
): RouteDrive {
  const key = routeCacheKey(pair.from, pair.to, routingHash);
  const result = routes[key] ?? estimateRoute(pair.from, pair.to);
  // Endpoints only, still: Google cannot be handed a pass-through waypoint, so
  // the link is honestly "get me there". What #36 adds is the ANSWER about that
  // link — measured server-side and read here off the NavMap, never computed.
  // This runs inside a client useMemo; it must not pay O(n·m) haversines.
  // A deviation exists only where a corridor did — the check needs a HERE
  // polyline to measure against — so the number alone carries the verdict.
  const handoff = buildNavigationHandoff(pair.from, pair.to, {
    deviationMeters: nav[key]?.deviationMeters ?? null,
  });
  return {
    key,
    label: driveLabel(result),
    estimate: result.source === "estimate",
    primaryRoad: result.primaryRoad,
    notices: result.notices,
    navUrl: handoff.url,
    navWegoUrl: handoff.wegoUrl,
    navVerdict: handoff.verdict,
    navDeviationMeters: handoff.deviationMeters,
    miles: driveMiles(result),
    minutes: driveMinutes(result),
  };
}

/**
 * One option on the split Navigate control (docs/design/43 §4). Two, always,
 * in the order the verdict earns: Google leads when its own route WAS the
 * corridor, HERE WeGo leads when it was not — because a worse route wearing the
 * RV-safe label is worse than an honest plain one.
 *
 * The copy lives here, not in the component, for the same reason the HERE
 * notice messages are server-composed: one place, and a place a test runner
 * can actually reach.
 */
export interface NavigationOption {
  id: "google" | "wego";
  title: string;
  caption: string;
  url: string;
  /** True on the first item — the one the button BODY takes. */
  primary: boolean;
}

export function navigationOptions(drive: RouteDrive): NavigationOption[] {
  const google: NavigationOption =
    drive.navVerdict === "checked"
      ? {
          id: "google",
          title: "Google Maps · RV-checked",
          caption: `within ${deviation(drive)} m of your corridor`,
          url: drive.navUrl,
          primary: true,
        }
      : {
          id: "google",
          title: "Google Maps · plain",
          caption: "endpoints only — not the checked corridor",
          url: drive.navUrl,
          primary: false,
        };
  // The WeGo caption is the design's state-③ string in BOTH states. Its
  // state-① wording ("honours 12′6″ · 8′6″ · 36′ · 26,000 lb natively") is a
  // promise about a third-party URL that carries no dimensions at all — see
  // providers/navigation.ts's wegoUrl, and the vet's FLAG on §4.
  const wego: NavigationOption = {
    id: "wego",
    title: "HERE WeGo · truck profile",
    caption: "the only one of the two that knows your rig",
    url: drive.navWegoUrl,
    primary: drive.navVerdict !== "checked",
  };
  return drive.navVerdict === "checked" ? [google, wego] : [wego, google];
}

/** The caption under the button: green when the claim is true, amber when it
 * is not. The amber string is the shipped one, character for character. */
export interface NavigationCaption {
  tone: NavigationVerdict;
  text: string;
}

export function navigationCaption(drive: RouteDrive): NavigationCaption {
  if (drive.navVerdict === "checked") {
    return {
      tone: "checked",
      text: `Checked against the RV-safe corridor — within ${deviation(drive)} m.`,
    };
  }
  return { tone: "plain", text: "Navigation may not follow the RV-safe route — check notices." };
}

/** Whole meters. A corridor is not measured in centimetres. */
function deviation(drive: RouteDrive): number {
  return Math.round(drive.navDeviationMeters ?? 0);
}

/**
 * Every drive on the trip, resolved once and indexed the two ways the screen
 * needs it. The rail and the connectors read the SAME list, which is what makes
 * the rail exactly the sum of the drives you can see.
 */
function resolveDrives(trip: Trip, routes: RouteMap, routingHash: string, nav: NavMap) {
  const byFromStop = new Map<string, RouteDrive>();
  // Keyed by the leg the drive leaves, but it carries the leg it ARRIVES in:
  // an emptied leg in between means the crossing is not always i → i + 1.
  const boundaryByLeg = new Map<string, { drive: RouteDrive; toLegId: string }>();
  const all: RouteDrive[] = [];
  for (const pair of orderedPairs(trip)) {
    const drive = toDrive(pair, routes, routingHash, nav);
    all.push(drive);
    if (pair.legBoundary) boundaryByLeg.set(pair.fromLegId, { drive, toLegId: pair.toLegId });
    else byFromStop.set(pair.fromStopId, drive);
  }
  return { byFromStop, boundaryByLeg, all };
}

export function routeModel(
  trip: Trip,
  routes: RouteMap = {},
  routingHash: string = NO_ROUTING_HASH,
  nav: NavMap = {},
): RouteLeg[] {
  const { byFromStop, boundaryByLeg } = resolveDrives(trip, routes, routingHash, nav);
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
  routingHash: string = NO_ROUTING_HASH,
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
  // The rail sums miles and minutes; the corridor verdict has no total, so the
  // summary never needs (or pays for) a NavMap.
  const { all } = resolveDrives(trip, routes, routingHash, {});
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
/**
 * Splice the reservation `POST /api/reservations` just created onto the stop.
 *
 * A create is the one write with nothing to be optimistic about — only the
 * server can mint the id — so this takes the row the 201 handed back rather
 * than inventing one. It is also what an UNDONE delete calls: the row comes
 * back with a new id, which is why the toast re-POSTs instead of resurrecting.
 */
export function appendReservation(trip: Trip, stopId: string, r: Reservation): Trip {
  return updateStop(trip, stopId, (s) => ({ ...s, reservations: [...s.reservations, r] }));
}

/** The leaf delete: optimistic, and reversed by re-appending the 201's row. */
export function removeReservation(trip: Trip, stopId: string, resId: string): Trip {
  return updateStop(trip, stopId, (s) => ({
    ...s,
    reservations: s.reservations.filter((r) => r.id !== resId),
  }));
}

/**
 * The edit form's Save, applied optimistically. It takes the SAME patch the
 * PATCH body carries, so a key the form left out is a field left alone here
 * too — the screen and the row can't disagree about what was sent.
 */
export function setReservationFields(
  trip: Trip,
  stopId: string,
  resId: string,
  patch: ReservationPatchInput,
): Trip {
  return updateStop(trip, stopId, (s) => ({
    ...s,
    reservations: s.reservations.map((r) => (r.id === resId ? { ...r, ...patch } : r)),
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
/** Splice the idea `POST /api/ideas` just created onto the stop. */
export function appendIdea(trip: Trip, stopId: string, i: Idea): Trip {
  return updateStop(trip, stopId, (s) => ({ ...s, ideas: [...s.ideas, i] }));
}

/** The other leaf delete — same shape, same undo. */
export function removeIdea(trip: Trip, stopId: string, ideaId: string): Trip {
  return updateStop(trip, stopId, (s) => ({
    ...s,
    ideas: s.ideas.filter((it) => it.id !== ideaId),
  }));
}

/**
 * "Book" — the idea leaves and the reservation the server minted takes its
 * place, in one tree update so the sheet never renders both.
 *
 * The reservation is the row the 201 handed back, TYPE INCLUDED: the type is
 * the one you picked on the way in, not a client guess. (This used to build
 * the row locally and hardcode "activity".)
 */
export function applyPromotion(
  trip: Trip,
  stopId: string,
  ideaId: string,
  r: Reservation,
): Trip {
  return updateStop(trip, stopId, (s) => ({
    ...s,
    ideas: s.ideas.filter((it) => it.id !== ideaId),
    reservations: [...s.reservations, r],
  }));
}

/** The longest open run in the trip window, as `[startIndex, length]`. */
function longestOpenRun(days: { kind: DayKind }[]): [number, number] {
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
  return [best, bestLen];
}

/**
 * Assign dates to a floating stop.
 *
 * `gap` is the open span it was DROPPED on — the same `TimelineGap` the gantt's
 * `OpenLane` rendered, so `startCol` is a 1-based column into the very day list
 * `deriveDays` builds here. The stop takes the gap's first date and
 * `min(nights, gap.span)` days of it; a 1-day gap therefore yields
 * `arrive === depart`, a legal single-day stop.
 *
 * `gap === null` — the stop sheet's "Schedule" button, which has no drop target
 * — keeps the original behaviour: the LARGEST open run. It is the default, so
 * every existing two-argument call site is unchanged.
 */
export function scheduleFloating(
  trip: Trip,
  stopId: string,
  gap: TimelineGap | null = null,
  nights = 3,
): Trip {
  const stops = allStops(trip);
  const { days } = deriveDays(trip, stops);

  let start: number;
  let runLen: number;
  if (gap) {
    start = gap.startCol - 1;
    // A gap the trip no longer has (the window moved under the drag) is a
    // no-op rather than a guess.
    if (start < 0 || start >= days.length) return trip;
    runLen = Math.min(gap.span, days.length - start);
  } else {
    [start, runLen] = longestOpenRun(days);
    if (start < 0) return trip;
  }
  if (runLen < 1) return trip;

  const span = Math.min(nights, runLen);
  const arriveDate = days[start]!.date;
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


// ── leg + stop structure (pure; return a new Trip) ─────────────────────────
//
// The row menus in the route lens. A CREATE is the one write with nothing to
// be optimistic about — only the server can mint the id — so the two `append`
// helpers take the row the 201 handed back; everything else here is applied
// optimistically, and its caller keeps the pre-change trip as the snapshot a
// failed write rolls back to.

/** Splice the leg `POST /api/legs` just created onto the end of the trip. */
export function appendLeg(trip: Trip, leg: Leg): Trip {
  return { ...trip, legs: [...trip.legs, leg] };
}

/** Splice the stop `POST /api/stops` just created into the leg it belongs to. */
export function appendStop(trip: Trip, stop: Stop): Trip {
  return mapLegs(trip, (l) =>
    l.id === stop.legId ? { ...l, stops: [...l.stops, stop] } : l,
  );
}

/** The leg header's inline rename. */
export function renameLeg(trip: Trip, legId: string, title: string): Trip {
  return mapLegs(trip, (l) => (l.id === legId ? { ...l, title } : l));
}

/**
 * The stop row's inline rename. It edits the NAME only — the coordinates and
 * the Google id are what the place picker owns (#23), not a text field.
 */
export function renameStop(trip: Trip, stopId: string, name: string): Trip {
  return updateStop(trip, stopId, (s) => ({ ...s, place: { ...s.place, name } }));
}

/** Delete a leg. Its stops go with it, the way the FK cascade does server-side. */
export function removeLeg(trip: Trip, legId: string): Trip {
  return { ...trip, legs: trip.legs.filter((l) => l.id !== legId) };
}

/** Delete a stop. Its reservations and ideas go with it. */
export function removeStop(trip: Trip, stopId: string): Trip {
  return mapLegs(trip, (l) => ({ ...l, stops: l.stops.filter((s) => s.id !== stopId) }));
}

/** The leg ids in render order — the whole new order `reorder` POSTs. */
export function legOrder(trip: Trip): string[] {
  return [...trip.legs].sort((a, b) => a.sortOrder - b.sortOrder).map((l) => l.id);
}

/** Is there a leg on that side to swap with? (The menu item is disabled if not.) */
export function canMoveLeg(trip: Trip, legId: string, delta: -1 | 1): boolean {
  const order = legOrder(trip);
  const from = order.indexOf(legId);
  return from >= 0 && from + delta >= 0 && from + delta < order.length;
}

/**
 * "Move leg up/down". Every leg is renumbered from its new position, so a
 * half-applied swap can never leave two legs sharing a sortOrder — the same
 * shape the server's one-transaction renumber uses.
 */
export function moveLeg(trip: Trip, legId: string, delta: -1 | 1): Trip {
  if (!canMoveLeg(trip, legId, delta)) return trip;
  const order = legOrder(trip);
  const from = order.indexOf(legId);
  const [moved] = order.splice(from, 1);
  order.splice(from + delta, 0, moved!);
  return { ...trip, legs: trip.legs.map((l) => ({ ...l, sortOrder: order.indexOf(l.id) })) };
}

/**
 * "Move to leg". The stop is re-parented and appended to the end of the
 * destination — the same "the server appends" rule a create follows, so the
 * optimistic tree and the row the PATCH writes agree.
 */
export function moveStopToLeg(trip: Trip, stopId: string, legId: string): Trip {
  const moving = stopMap(trip).get(stopId);
  if (!moving || moving.legId === legId) return trip;
  const highest = trip.legs
    .find((l) => l.id === legId)
    ?.stops.reduce((n, s) => Math.max(n, s.sortOrder), -1);
  if (highest === undefined) return trip;
  const moved: Stop = { ...moving, legId, sortOrder: highest + 1 };
  return mapLegs(trip, (l) => {
    if (l.id === moving.legId) return { ...l, stops: l.stops.filter((s) => s.id !== stopId) };
    if (l.id === legId) return { ...l, stops: [...l.stops, moved] };
    return l;
  });
}

/** The stop-dates dialog, and "Unschedule" — which is both dates going null. */
export function setStopDates(
  trip: Trip,
  stopId: string,
  arriveDate: IsoDate | null,
  departDate: IsoDate | null,
): Trip {
  return updateStop(trip, stopId, (s) => ({ ...s, arriveDate, departDate }));
}
