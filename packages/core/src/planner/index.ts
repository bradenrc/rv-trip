import { deriveDays, type DayKind } from "../domain/derive-days";
import {
  isScheduled,
  type Trip,
  type Chapter,
  type Destination,
  type Reservation,
  type ReservationPatchInput,
  type Idea,
  type IdeaCategory,
  type IsoDate,
  type Place,
  type ReservationType,
  type TravelMode,
  type TransportKind,
  type Segment,
} from "../domain/types";
import {
  TRANSPORT_KIND_ORDER,
  countTransportKind,
  countsTowardClock,
  effectiveTransportKind,
} from "../domain/transport-kind";
import { drivePairs, orderedChapterDestinations, routeCacheKey, type OrderedPair } from "../domain/route-order";
import { localDate, withReconciledSegments } from "../domain/segments";
import { instantToLocal, minutesBetween } from "../domain/airports";
import { hasCoords } from "../domain/bounds";
import { NO_ROUTING_HASH } from "../domain/rig";
import { DEFAULT_UNITS, type Units } from "../domain/units";
import { estimateRoute, type RouteResult, type RouteNotice } from "../providers/index";
import { driveLabel, driveMiles, driveMinutes, formatDriveTime } from "../providers/route-format";
import {
  buildNavigationHandoff,
  type NavCheck,
  type NavigationVerdict,
} from "../providers/navigation";
import { dateRange, monthAbbr, weekdayLetter, weekdayMonthDay, addDays } from "./dates";

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
/** The map's drive arcs — one model, two renderers (#44 i3). `RouteMap` is
 * declared below and imported there as a type, so nothing loads twice. */
export * from "./map-arcs";
/** The map's destination discs + camera box — the other half of the same model
 * (#44 i4). Also the home of the scheduled ordinal the destination sheet prints. */
export * from "./map-pins";
/** The trip's idea shelf — the side rail's model (#80 i1). */
export * from "./shelf";
/** Trip surfacing — the saves near a trip (#111 i3). */
export * from "./nearby-saves";
/** The Journal lens and "Did it"'s today's destination (#113 · #106). */
export * from "./journal";
/** "Last time here" — the saves a past trip left near this one (#113 · #107). */
export * from "./for-next-time";

export function allDestinations(trip: Trip): Destination[] {
  return trip.chapters.flatMap((l) => l.destinations);
}
export function destinationMap(trip: Trip): Map<string, Destination> {
  return new Map(allDestinations(trip).map((s) => [s.id, s]));
}

// ── Timeline (gantt) view-model ────────────────────────────────────────────

export interface TimelineBar {
  destinationId: string;
  name: string;
  range: string;
  startCol: number;
  span: number;
  rating: number;
  resCount: number;
  ideaCount: number;
  showMeta: boolean;
  /**
   * How the destination was ARRIVED at — its inbound segment's mode (#110 §2). `null`
   * when nothing arrives (Greece's first Athens: no home base, no hop in), so
   * the bar draws no navy edge.
   */
  arriveMode: TravelMode | null;
}
export interface TimelineChapter {
  id: string;
  /** "Chapter 2" for a NAMED chapter (N counts named ones only, #155 · Q1 A);
   * null for an unnamed one, which renders no header. */
  kicker: string | null;
  name: string | null;
  bars: TimelineBar[];
}
export interface TimelineGap {
  startCol: number;
  span: number;
}
export interface FloatingDestination {
  id: string;
  name: string;
  note: string | null;
  ideaCount: number;
  firstIdea: string | null;
}
/** One rhythm cell. `mode` is set on travel days only — the web centres a
 * Plane/Ship on fly/ferry, native a ✈/⛴ text glyph. */
export interface RhythmCell {
  kind: DayKind;
  color: string;
  title: string;
  mode?: TravelMode;
  /** The hop a travel day belongs to — what a fly/ferry cell's click opens on
   * the Route lens (#104 · Q5 A). */
  segmentId?: string;
}
export interface TimelineModel {
  rhythm: RhythmCell[];
  ruler: { letter: string; label: string; weekStart: boolean }[];
  chapters: TimelineChapter[];
  gaps: TimelineGap[];
  openCount: number;
  gapCount: number;
  openLabel: string;
  tailHint: string;
  floating: FloatingDestination[];
  allScheduled: boolean;
  /**
   * The travel modes the trip's rhythm actually has, in legend order (Drive ·
   * Fly · Ferry) — `GanttLegend({ modes })` and the phone's rhythm legend name
   * only these (klunk row 3), so PNW never shows a Fly key.
   */
  modes: TravelMode[];
}

/** The web paints the rhythm strip with these CSS variables; the native app
 * reads `kind` instead. Both are carried so neither client re-derives it. */
const KIND_COLOR: Record<DayKind, string> = {
  travel: "var(--color-rv-navy)",
  stay: "var(--color-rv-green)",
  empty: "var(--color-rv-navy-soft)",
};

const MODE_LABEL: Record<TravelMode, string> = { drive: "Drive", fly: "Fly", ferry: "Ferry" };

export function timelineModel(trip: Trip): TimelineModel {
  const destinations = allDestinations(trip);
  const byId = destinationMap(trip);
  const { days, unscheduledDestinationIds } = deriveDays(trip, destinations, trip.segments);

  // A travel day belongs to the destination it ARRIVES at (the run rule below), so a
  // day bound for home belongs to no destination and ends the bar before it.
  const cols = days.map((c, i) => ({
    index: i + 1,
    date: c.date,
    kind: c.kind as DayKind,
    mode: c.mode,
    segmentId: c.segmentId,
    destinationId: c.kind === "stay" ? c.destinationId! : c.kind === "travel" ? (c.toDestinationId ?? null) : null,
  }));

  const rhythm = cols.map((c): RhythmCell => {
    const destination = c.destinationId ? byId.get(c.destinationId) : null;
    if (c.kind === "travel") {
      const mode = c.mode ?? "drive";
      return {
        kind: c.kind,
        color: KIND_COLOR[c.kind],
        title: `${c.date} — ${MODE_LABEL[mode]} → ${destination ? destination.place.name : "home"}`,
        mode,
        ...(c.segmentId !== undefined && { segmentId: c.segmentId }),
      };
    }
    const title = c.kind === "stay" ? `Stay · ${destination?.place.name ?? ""}` : "Open";
    return { kind: c.kind, color: KIND_COLOR[c.kind], title: `${c.date} — ${title}` };
  });

  const arriveModeOf = new Map(
    trip.segments.flatMap((s) => (s.toDestinationId === null ? [] : [[s.toDestinationId, s.mode] as const])),
  );

  const ruler = cols.map((c, i) => {
    const day = Number(c.date.slice(8));
    const weekStart = i % 7 === 0;
    return {
      letter: weekdayLetter(c.date),
      label: weekStart ? `${monthAbbr(c.date)} ${day}` : String(day),
      weekStart: weekStart && i > 0,
    };
  });

  // contiguous same-destination runs → segments
  const segments: { destinationId: string; startCol: number; span: number }[] = [];
  cols.forEach((c, i) => {
    if (!c.destinationId) return;
    const prev = cols[i - 1];
    if (prev && prev.destinationId === c.destinationId) segments[segments.length - 1]!.span++;
    else segments.push({ destinationId: c.destinationId, startCol: c.index, span: 1 });
  });

  const kickers = chapterKickers(trip.chapters);
  const chapters: TimelineChapter[] = trip.chapters.map((chapter) => ({
    id: chapter.id,
    kicker: kickers.get(chapter.id) ?? null,
    name: chapter.title,
    bars: segments
      .filter((s) => byId.get(s.destinationId)?.chapterId === chapter.id)
      .map((s) => {
        const destination = byId.get(s.destinationId)!;
        const resCount = destination.reservations.length;
        const ideaCount = destination.ideas.length;
        const rating = destination.rating ?? 0;
        return {
          destinationId: s.destinationId,
          name: destination.place.name,
          range: isScheduled(destination)
            ? dateRange(destination.arriveDate, destination.departDate)
            : "",
          startCol: s.startCol,
          span: s.span,
          rating,
          resCount,
          ideaCount,
          showMeta: rating > 0 || resCount > 0 || ideaCount > 0,
          arriveMode: arriveModeOf.get(s.destinationId) ?? null,
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
  const lastName = lastScheduled ? byId.get(lastScheduled.destinationId)?.place.name : null;

  const floating: FloatingDestination[] = unscheduledDestinationIds
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
    chapters,
    gaps,
    openCount,
    gapCount,
    openLabel,
    tailHint,
    floating,
    allScheduled: floating.length === 0,
    modes: (["drive", "fly", "ferry"] as const).filter((m) => rhythm.some((c) => c.mode === m)),
  };
}

// ── Route view-model ───────────────────────────────────────────────────────
export interface RouteReservation {
  id: string;
  name: string;
  type: ReservationType;
  cost: number | null;
  dates: string | null;
  /** #105 · a stay's kind — the route row prints its label ("Friends"). */
  lodgingKind: Reservation["lodgingKind"];
}
export interface RouteIdea {
  id: string;
  title: string;
  /** The idea's OWN kind (#80). It used to be a hardcoded activity type, so
   * every idea on the route lens was a blue "Do" whatever it was; the renderer
   * resolves this through `ideaCategoryMeta`, the one bridge into the DS's
   * five-category language. */
  category: IdeaCategory;
  status: Idea["status"];
}
export interface RouteRow {
  destination: Destination;
  dates: string | null;
  floating: boolean;
  rating: number;
  note: string | null;
  reservations: RouteReservation[];
  ideas: RouteIdea[];
  showIdeaDivider: boolean;
  /** The drive OUT of this destination, when the next destination is in the same chapter. */
  drive: RouteDrive | null;
  /** The non-drive hop OUT of this destination (#104), when the next destination is in the
   * same chapter — a travel card where a drive row would be. */
  hop: RouteHop | null;
}
export interface RouteChapter {
  id: string;
  /** "Chapter 2" for a NAMED chapter — N counts named chapters only (#155 ·
   * Q1 A). Null for an unnamed chapter, which renders no header. */
  kicker: string | null;
  name: string | null;
  rows: RouteRow[];
  /** The drive that crosses out of this chapter — drawn after the rows as a
   * plain drive row (#155 removed the "LEG 1 → LEG 2" seam above it). */
  outboundDrive: RouteDrive | null;
  /**
   * The non-drive hop that crosses OUT of this chapter (#104 · vet MED) — the
   * travel-card twin of `outboundDrive`, drawn where it is.
   * Greece's Athens → Mykonos flight and Naxos → Athens flight are these.
   */
  outboundHop: RouteHop | null;
  /** Home → the first destination, drawn above the chapter's rows — only when that hop is
   * NOT a drive, so a drive trip's Route stays exactly as it was. */
  leadingHop: RouteHop | null;
  /** → home, drawn after the chapter's last row — only when a → home row exists
   * (`reconcileSegments` never invents one) and it is not a drive. */
  returnHop: RouteHop | null;
}

/** A booking on a hop — a flight or a ferry, with its local times. */
export interface RouteHopBooking {
  kind: "booking";
  id: string;
  name: string;
  /** #155 · Q4 A — the EFFECTIVE kind: the stored one, or the hop's mode. */
  transportKind: TransportKind;
  /** "06:05" in the zone it leaves from; null for an untimed booking. */
  departTime: string | null;
  departAbbr: string | null;
  arriveTime: string | null;
  arriveAbbr: string | null;
  /** "2h 05m" in the air (or on the water). */
  duration: string | null;
  reservation: Reservation;
}
/** The gap between one booking landing and the next one leaving. */
export interface RouteHopLayover {
  kind: "layover";
  /** "2h 30m layover at LAX" */
  label: string;
}
export type RouteHopItem = RouteHopBooking | RouteHopLayover;

/** A fly or ferry hop, as its travel card draws it. */
export interface RouteHop {
  segmentId: string;
  mode: TravelMode;
  fromDestinationId: string | null;
  toDestinationId: string | null;
  /** "Boise" (the home base) or the destination's name. */
  fromName: string;
  /** "home" for a hop going home. */
  toName: string;
  /** "Sat Jan 16", or "Sun Jan 24 → Mon Jan 25" for an overnight hop. Null for
   * a hop with no date to borrow (a floating destination on either end). */
  dayLabel: string | null;
  /** The segment's departAt → arriveAt ("10h 40m"), when it is timed. */
  doorToDoor: string | null;
  /** Lands on a later local date than it leaves. */
  overnight: boolean;
  /** The card's mono meta: "Sat Jan 16 · 10h 40m door to door", or
   * "Sun Jan 24 → Mon Jan 25 · redeye". */
  meta: string | null;
  /** #155 · Q3 B — always empty: the bookings, layovers, Edit and Add moved to
   * the hop's Logistics group (`logisticsModel`). Kept so a parked hop and
   * older readers type unchanged. */
  items: RouteHopItem[];
  /** How many bookings (of any kind) hang on the hop. */
  bookings: number;
  /** #155 · Q3 B — "2 flights · 1 shuttle → Logistics": the count chip that
   * replaces the booking rows and jumps to `#hop-<segmentId>`. Null on a parked
   * hop, which is unchanged. */
  chip: string | null;
  /**
   * #129 · Q11 A — flights KEPT on a hop that now drives: "1 flight booking
   * parked — comes back if you fly". Such a hop is drawn (mode `drive`, no
   * items) so its inline mode switch is always reachable, on any trip mode.
   * 0 for every fly/ferry hop.
   */
  parked: number;
}

/**
 * The server-resolved routes, keyed by `from|to|routingHash` — a map, never a
 * positional array, so it crosses the RSC boundary and survives client-side
 * reordering. A key MISS (you dragged a floating destination and invented a pair the
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
  /** The segment row this drive is (#104) — the ⋯ menu's `PATCH
   * /api/segments/:id` target. Null only for a pair an optimistic edit
   * invented before the server reconciled it. */
  segmentId: string | null;
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
  units: Units,
  segmentId: string | null = null,
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
    segmentId,
    label: driveLabel(result, units),
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
function resolveDrives(
  trip: Trip,
  routes: RouteMap,
  routingHash: string,
  nav: NavMap,
  units: Units = DEFAULT_UNITS,
) {
  const byFromDestination = new Map<string, RouteDrive>();
  // Keyed by the chapter the drive leaves, but it carries the chapter it ARRIVES in:
  // an emptied chapter in between means the crossing is not always i → i + 1.
  const boundaryByChapter = new Map<string, { drive: RouteDrive; toChapterId: string }>();
  const all: RouteDrive[] = [];
  const segmentOf = new Map(
    trip.segments.map((s) => [`${s.fromDestinationId ?? ""}|${s.toDestinationId ?? ""}`, s.id] as const),
  );
  // DRIVEN pairs only (#110 §6): a flight or a ferry has no road to route, no
  // corridor to check and no miles on the rail.
  for (const pair of drivePairs(trip)) {
    const segmentId = segmentOf.get(`${pair.fromDestinationId}|${pair.toDestinationId}`) ?? null;
    const drive = toDrive(pair, routes, routingHash, nav, units, segmentId);
    all.push(drive);
    if (pair.chapterBoundary) boundaryByChapter.set(pair.fromChapterId, { drive, toChapterId: pair.toChapterId });
    else byFromDestination.set(pair.fromDestinationId, drive);
  }
  return { byFromDestination, boundaryByChapter, all };
}

export function routeModel(
  trip: Trip,
  routes: RouteMap = {},
  routingHash: string = NO_ROUTING_HASH,
  nav: NavMap = {},
  /** Display only — every drive is still measured in miles. Defaulted so a
   * caller with no preference in hand (a test, the seed) keeps the product
   * default rather than having to state it. */
  units: Units = DEFAULT_UNITS,
): RouteChapter[] {
  const { byFromDestination, boundaryByChapter } = resolveDrives(trip, routes, routingHash, nav, units);
  const chapters = [...trip.chapters].sort((a, b) => a.sortOrder - b.sortOrder);
  const kickers = chapterKickers(chapters);
  const hops = resolveHops(trip);

  return chapters.map((chapter) => {
    const ordered = orderedChapterDestinations(chapter.destinations);

    const rows: RouteRow[] = ordered.map((destination) => ({
      destination,
      dates: isScheduled(destination) ? dateRange(destination.arriveDate, destination.departDate) : null,
      floating: !isScheduled(destination),
      rating: destination.rating ?? 0,
      note: destination.notes,
      reservations: destination.reservations.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        cost: r.cost,
        dates: resDates(r),
        lodgingKind: r.lodgingKind,
      })),
      // #131 · Itinerary lists KNOWNS only: an idea still at status `idea` is a
      // maybe, and maybes live on the Ideas tab (grouped under their destination).
      ideas: destination.ideas
        .filter((it) => it.status !== "idea")
        .map((it) => ({
          id: it.id,
          title: it.title,
          category: it.category,
          status: it.status,
        })),
      showIdeaDivider:
        destination.reservations.length > 0 && destination.ideas.some((it) => it.status !== "idea"),
      drive: byFromDestination.get(destination.id) ?? null,
      hop: hops.byFromDestination.get(destination.id) ?? null,
    }));

    const boundary = boundaryByChapter.get(chapter.id) ?? null;
    const boundaryHop = hops.boundaryByChapter.get(chapter.id) ?? null;
    return {
      id: chapter.id,
      kicker: kickers.get(chapter.id) ?? null,
      name: chapter.title,
      rows,
      outboundDrive: boundary?.drive ?? null,
      outboundHop: boundaryHop?.hop ?? null,
      leadingHop: hops.leading?.chapterId === chapter.id ? hops.leading.hop : null,
      returnHop: hops.home?.chapterId === chapter.id ? hops.home.hop : null,
    };
  });
}

/**
 * #155 · Q1 A — "Chapter N" for each NAMED chapter, by sortOrder; N counts the
 * named ones only, so an unnamed chapter between two named ones never leaves a
 * gap in the numbering. An unnamed chapter has no entry.
 */
export function chapterKickers(chapters: Pick<Chapter, "id" | "title" | "sortOrder">[]): Map<string, string> {
  const out = new Map<string, string>();
  let n = 0;
  for (const c of [...chapters].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (c.title) out.set(c.id, `Chapter ${++n}`);
  }
  return out;
}

/**
 * #155 · Q1 A — the count kicker a trip with NO named chapter shows where a
 * chapter header would be: "3 destinations" · "1 destination". Null as soon as
 * one chapter is named (its header carries the screen instead).
 */
export function routeCountKicker(trip: Pick<Trip, "chapters">): string | null {
  if (trip.chapters.some((c) => c.title)) return null;
  const n = trip.chapters.reduce((a, c) => a + c.destinations.length, 0);
  return `${n} destination${n === 1 ? "" : "s"}`;
}

/**
 * #155 · Q2 A — a destination card's subtitle: the trip's area ("Guanacaste"),
 * shown only when it is set and the destination's name does not already
 * contain it. A destination has no locality of its own, so this is the one
 * place-above-it the trip knows.
 */
export function areaSubtitle(trip: Pick<Trip, "area">, destinationName: string): string | null {
  const area = trip.area?.name?.trim();
  if (!area) return null;
  return destinationName.toLowerCase().includes(area.toLowerCase()) ? null : area;
}

/**
 * #155 · Q3 B — the hop card's count chip: the non-zero kinds in the order
 * flight · ferry · shuttle · train · car, each "1 flight" / "2 flights", joined
 * by " · ", then " → Logistics". With no booking at all it reads "no flight
 * added → Logistics" ("no ferry added" on a ferry hop — the empty group's word).
 */
export function hopChip(mode: TravelMode, bookings: Pick<Reservation, "transportKind">[]): string {
  if (bookings.length === 0) return `${emptyHopLabel(mode)} → Logistics`;
  const counts = new Map<TransportKind, number>();
  for (const b of bookings) {
    const k = effectiveTransportKind(b, mode);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const parts = TRANSPORT_KIND_ORDER.filter((k) => counts.has(k)).map((k) => countTransportKind(k, counts.get(k)!));
  return `${parts.join(" · ")} → Logistics`;
}

/** "no flight added" · "no ferry added" — the empty Logistics row. */
function emptyHopLabel(mode: TravelMode): string {
  return mode === "ferry" ? "no ferry added" : "no flight added";
}

/**
 * Every NON-drive hop on the trip, indexed the way the route lens draws it —
 * the travel-card mirror of `resolveDrives`. A hop needs no coordinates (a
 * flight is not routed), so it is read straight off the segments.
 */
function resolveHops(trip: Trip) {
  const destinations = destinationMap(trip);
  const byFromDestination = new Map<string, RouteHop>();
  const boundaryByChapter = new Map<string, { hop: RouteHop; toChapterId: string }>();
  let leading: { chapterId: string; hop: RouteHop } | null = null;
  let home: { chapterId: string; hop: RouteHop } | null = null;
  for (const seg of trip.segments) {
    // A drive is drawn by `resolveDrives` — unless it carries parked flights
    // (#129), which need their row and their way back to Fly.
    if (seg.mode === "drive" && seg.reservations.length === 0) continue;
    const from = seg.fromDestinationId ? destinations.get(seg.fromDestinationId) : undefined;
    const to = seg.toDestinationId ? destinations.get(seg.toDestinationId) : undefined;
    if (seg.fromDestinationId === null && to) {
      leading = { chapterId: to.chapterId, hop: toHop(trip, seg, from, to) };
    } else if (seg.toDestinationId === null && from) {
      home = { chapterId: from.chapterId, hop: toHop(trip, seg, from, to) };
    } else if (from && to) {
      const hop = toHop(trip, seg, from, to);
      if (from.chapterId === to.chapterId) byFromDestination.set(from.id, hop);
      else boundaryByChapter.set(from.chapterId, { hop, toChapterId: to.chapterId });
    }
  }
  return { byFromDestination, boundaryByChapter, leading, home };
}

/** "Boise, ID" reads "Boise" on the card — the city, as the ticket names it. */
function homeName(homeBase: string | null): string {
  return homeBase ? homeBase.split(",")[0]!.trim() : "Home";
}

function toHop(trip: Trip, seg: Segment, from: Destination | undefined, to: Destination | undefined): RouteHop {
  const timed = seg.departAt !== null && seg.arriveAt !== null;
  const departDay = timed ? localDate(seg.departAt!, seg.departTz) : null;
  const arriveDay = timed ? localDate(seg.arriveAt!, seg.arriveTz) : null;
  // An untimed hop borrows its day the way derive-days does: the day of the
  // destination it arrives at, or — going home — the day it leaves.
  const borrowed = to ? to.arriveDate : (from?.departDate ?? null);
  const overnight = departDay !== null && arriveDay !== null && arriveDay > departDay;
  const dayLabel = departDay
    ? overnight
      ? `${weekdayMonthDay(departDay)} → ${weekdayMonthDay(arriveDay!)}`
      : weekdayMonthDay(departDay)
    : borrowed
      ? weekdayMonthDay(borrowed)
      : null;

  const parked = seg.mode === "drive" ? seg.reservations.length : 0;
  const bookings = parked > 0 ? [] : seg.reservations;
  // #155 · Q4 A (vet MED) — only flights and ferries make a connection: a
  // shuttle beside one flight is not "door to door".
  const clockBookings = bookings.filter((r) => countsTowardClock(effectiveTransportKind(r, seg.mode)));

  // Door to door is worth saying only when it is more than one booking's own
  // time — a connection. A single ferry already carries its 45m.
  const doorToDoor =
    timed && clockBookings.length > 1 ? formatDriveTime(minutesBetween(seg.departAt!, seg.arriveAt!)) : null;
  const meta = dayLabel
    ? overnight
      ? `${dayLabel} · redeye`
      : doorToDoor
        ? `${dayLabel} · ${doorToDoor} door to door`
        : dayLabel
    : null;

  return {
    segmentId: seg.id,
    mode: seg.mode,
    fromDestinationId: seg.fromDestinationId,
    toDestinationId: seg.toDestinationId,
    fromName: from ? from.place.name : homeName(trip.homeBase),
    toName: to ? to.place.name : "home",
    dayLabel,
    doorToDoor,
    overnight,
    meta,
    // #155 · Q3 B — the rows moved to the hop's Logistics group.
    items: [],
    bookings: bookings.length,
    parked,
    chip: parked > 0 ? null : hopChip(seg.mode, bookings),
  };
}

// ── Logistics (#155 · Q3 B · Q4 A) ─────────────────────────────────────────

/** One booking in a Logistics group, in local time with its zones. */
export interface LogisticsBooking extends RouteHopBooking {
  /** A shuttle / train / car — logistics AROUND the hop, drawn indented. */
  aside: boolean;
}
/** The ghost row of a group with no flight (or ferry) booked: "no flight
 * added", with the segment's own clock when it has one. */
export interface LogisticsEmpty {
  kind: "empty";
  label: string;
  departTime: string | null;
  departAbbr: string | null;
  arriveTime: string | null;
  arriveAbbr: string | null;
}
export type LogisticsItem = LogisticsBooking | RouteHopLayover | LogisticsEmpty;

export interface LogisticsGroup {
  segmentId: string;
  mode: "fly" | "ferry";
  fromDestinationId: string | null;
  toDestinationId: string | null;
  /** "Sat Jan 16" · "Sun Jan 24 → Mon Jan 25" — the hop's own day label. */
  dayLabel: string | null;
  fromName: string;
  toName: string;
  /** "10h 40m door to door" · "redeye" · null — the hop's meta, without its day. */
  meta: string | null;
  /** The hop goes HOME — its shuttles sort before the first flight. */
  home: boolean;
  items: LogisticsItem[];
}
export interface Logistics {
  groups: LogisticsGroup[];
}

/**
 * The Logistics section (#155 · Q3 B): one group per fly or ferry segment,
 * booked or not, in segment order. Null when the trip has none — a drive-only
 * trip renders no section and no kicker. Derived here, beside the hop builder,
 * so the web and the phone draw the same groups from one function.
 *
 * Inside a group: flights and ferries by `startsAt`, with a layover line
 * between consecutive ones only. Shuttle, train and car sort AFTER the last
 * flight on an outbound hop and BEFORE the first one on a hop going home. A
 * group with no flight (or ferry) carries one ghost row in the flights' place.
 */
export function logisticsModel(trip: Trip): Logistics | null {
  const destinations = destinationMap(trip);
  const groups: LogisticsGroup[] = [...trip.segments]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((seg): seg is Segment & { mode: "fly" | "ferry" } => seg.mode !== "drive")
    .map((seg) => {
      const from = seg.fromDestinationId ? destinations.get(seg.fromDestinationId) : undefined;
      const to = seg.toDestinationId ? destinations.get(seg.toDestinationId) : undefined;
      const hop = toHop(trip, seg, from, to);
      const home = seg.toDestinationId === null;
      const byStart = (a: Reservation, b: Reservation) =>
        (a.startsAt ? Date.parse(a.startsAt) : Infinity) - (b.startsAt ? Date.parse(b.startsAt) : Infinity);
      const clock = seg.reservations
        .filter((r) => countsTowardClock(effectiveTransportKind(r, seg.mode)))
        .sort(byStart);
      const asides = seg.reservations
        .filter((r) => !countsTowardClock(effectiveTransportKind(r, seg.mode)))
        .sort(byStart);

      const flights: LogisticsItem[] = [];
      clock.forEach((r, i) => {
        const prev = clock[i - 1];
        if (prev?.endsAt && r.startsAt) {
          const gap = minutesBetween(prev.endsAt, r.startsAt);
          const at = /→\s*([A-Za-z]{3})$/.exec(prev.name)?.[1]?.toUpperCase();
          if (gap > 0) {
            flights.push({ kind: "layover", label: `${formatDriveTime(gap)} layover${at ? ` at ${at}` : ""}` });
          }
        }
        flights.push(logisticsBooking(r, seg.mode, false));
      });
      if (clock.length === 0) {
        const dep = seg.departAt && seg.departTz ? instantToLocal(seg.departAt, seg.departTz) : null;
        const arr = seg.arriveAt && seg.arriveTz ? instantToLocal(seg.arriveAt, seg.arriveTz) : null;
        flights.push({
          kind: "empty",
          label: emptyHopLabel(seg.mode),
          departTime: dep?.hhmm ?? null,
          departAbbr: dep?.abbr ?? null,
          arriveTime: arr?.hhmm ?? null,
          arriveAbbr: arr?.abbr ?? null,
        });
      }
      const around = asides.map((r) => logisticsBooking(r, seg.mode, true));

      return {
        segmentId: seg.id,
        mode: seg.mode,
        fromDestinationId: seg.fromDestinationId,
        toDestinationId: seg.toDestinationId,
        dayLabel: hop.dayLabel,
        fromName: hop.fromName,
        toName: hop.toName,
        meta: hop.overnight ? "redeye" : hop.doorToDoor ? `${hop.doorToDoor} door to door` : null,
        home,
        items: home ? [...around, ...flights] : [...flights, ...around],
      };
    });
  return groups.length > 0 ? { groups } : null;
}

function logisticsBooking(r: Reservation, mode: TravelMode, aside: boolean): LogisticsBooking {
  const dep = r.startsAt && r.startsTz ? instantToLocal(r.startsAt, r.startsTz) : null;
  const arr = r.endsAt && r.endsTz ? instantToLocal(r.endsAt, r.endsTz) : null;
  return {
    kind: "booking",
    id: r.id,
    name: r.name,
    transportKind: effectiveTransportKind(r, mode),
    aside,
    departTime: dep?.hhmm ?? null,
    departAbbr: dep?.abbr ?? null,
    arriveTime: arr?.hhmm ?? null,
    arriveAbbr: arr?.abbr ?? null,
    duration: r.startsAt && r.endsAt ? formatDriveTime(minutesBetween(r.startsAt, r.endsAt)) : null,
    reservation: r,
  };
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
  destinations: number;
  scheduled: number;
  floating: number;
  /** How many destinations have no coordinates — no pin, no connector, no HERE route
   * (#60 Q3 → A). Rendered only when > 0, the same rule `restrictionCount`
   * already follows: a permanent "0 without a place" would train the eye to
   * skip the slot. */
  unmapped: number;
  /**
   * The coordless destinations themselves, in route order. The rail's Locate needs
   * both halves the count cannot give it — the ids `POST /api/places/locate`
   * addresses, and the NAMES `locateToastMessage` reports back for the rows
   * Google could not place. /map gets these from its own `unmappedVisible`;
   * the planner has no map model, so they come from here.
   */
  unmappedDestinations: { id: string; name: string }[];
  days: number;
  openCount: number;
  gapCount: number;
  chapters: { id: string; name: string; destinations: number; cost: number }[];
}

export function routeSummary(
  trip: Trip,
  routes: RouteMap = {},
  routingHash: string = NO_ROUTING_HASH,
): RouteSummary {
  const destinations = allDestinations(trip);
  const destinationCost = (s: Destination) => s.reservations.reduce((x, r) => x + (r.cost ?? 0), 0);
  const { days } = deriveDays(trip, destinations, trip.segments);
  const openCount = days.filter((d) => d.kind === "empty").length;
  let gapCount = 0;
  days.forEach((d, i) => {
    if (d.kind === "empty" && (i === 0 || days[i - 1]!.kind !== "empty")) gapCount++;
  });

  // The SAME drives the connectors render — including the chapter-boundary drive
  // and the floating one. The rail used to sum trip-wide scheduled pairs while
  // the screen drew per-chapter ones, so the two had never agreed (G1/G2).
  // The rail sums miles and minutes; the corridor verdict has no total, so the
  // summary never needs (or pays for) a NavMap.
  const unmappedDestinations = destinations
    .filter((s) => !hasCoords(s.place))
    .map((s) => ({ id: s.id, name: s.place.name }));

  const { all } = resolveDrives(trip, routes, routingHash, {});
  const driveMilesTotal = all.reduce((a, d) => a + d.miles, 0);
  const driveMins = all.reduce((a, d) => a + d.minutes, 0);

  return {
    driveMiles: driveMilesTotal,
    driveTime: driveMilesTotal ? formatDriveTime(driveMins) : "—",
    restrictionCount: all.reduce((a, d) => a + d.notices.length, 0),
    totalCost: destinations.reduce((a, s) => a + destinationCost(s), 0),
    destinations: destinations.length,
    scheduled: destinations.filter(isScheduled).length,
    floating: destinations.filter((s) => !isScheduled(s)).length,
    unmapped: unmappedDestinations.length,
    unmappedDestinations,
    days: days.length,
    openCount,
    gapCount,
    // #155 · Q1 A — the rail's Chapters block names NAMED chapters only (and
    // renders not at all when there is none).
    chapters: [...trip.chapters]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .filter((l): l is typeof l & { title: string } => l.title !== null)
      .map((l) => ({
        id: l.id,
        name: l.title,
        destinations: l.destinations.length,
        cost: l.destinations.reduce((a, s) => a + destinationCost(s), 0),
      })),
  };
}

// ── mutations (pure; return a new Trip) ────────────────────────────────────
function mapChapters(trip: Trip, fn: (l: Chapter) => Chapter): Trip {
  return { ...trip, chapters: trip.chapters.map(fn) };
}
export function updateDestination(trip: Trip, destinationId: string, patch: (s: Destination) => Destination): Trip {
  return mapChapters(trip, (l) => ({
    ...l,
    destinations: l.destinations.map((s) => (s.id === destinationId ? patch(s) : s)),
  }));
}
export function setDestinationRating(trip: Trip, destinationId: string, rating: number): Trip {
  return updateDestination(trip, destinationId, (s) => ({ ...s, rating: rating === 0 ? null : rating }));
}
export function setDestinationNote(trip: Trip, destinationId: string, note: string): Trip {
  return updateDestination(trip, destinationId, (s) => ({ ...s, notes: note }));
}
export function setReservationRating(trip: Trip, destinationId: string, resId: string, rating: number): Trip {
  return updateDestination(trip, destinationId, (s) => ({
    ...s,
    reservations: s.reservations.map((r) =>
      r.id === resId ? { ...r, rating: r.rating === rating ? null : rating || null } : r,
    ),
  }));
}
export function setReservationNote(trip: Trip, destinationId: string, resId: string, notes: string): Trip {
  return updateDestination(trip, destinationId, (s) => ({
    ...s,
    reservations: s.reservations.map((r) => (r.id === resId ? { ...r, notes } : r)),
  }));
}
/**
 * Splice the reservation `POST /api/reservations` just created onto the destination.
 *
 * A create is the one write with nothing to be optimistic about — only the
 * server can mint the id — so this takes the row the 201 handed back rather
 * than inventing one. It is also what an UNDONE delete calls: the row comes
 * back with a new id, which is why the toast re-POSTs instead of resurrecting.
 */
export function appendReservation(trip: Trip, destinationId: string, r: Reservation): Trip {
  return updateDestination(trip, destinationId, (s) => ({ ...s, reservations: [...s.reservations, r] }));
}

/** The leaf delete: optimistic, and reversed by re-appending the 201's row. */
export function removeReservation(trip: Trip, destinationId: string, resId: string): Trip {
  return updateDestination(trip, destinationId, (s) => ({
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
  destinationId: string,
  resId: string,
  patch: ReservationPatchInput,
): Trip {
  return updateDestination(trip, destinationId, (s) => ({
    ...s,
    reservations: s.reservations.map((r) => (r.id === resId ? { ...r, ...patch } : r)),
  }));
}
export function cycleIdeaStatus(trip: Trip, destinationId: string, ideaId: string): Trip {
  const order: Idea["status"][] = ["idea", "planned", "done"];
  return updateDestination(trip, destinationId, (s) => ({
    ...s,
    ideas: s.ideas.map((it) =>
      it.id === ideaId
        ? { ...it, status: order[(order.indexOf(it.status) + 1) % 3]! }
        : it,
    ),
  }));
}
export function setIdeaRating(trip: Trip, destinationId: string, ideaId: string, rating: number): Trip {
  return updateDestination(trip, destinationId, (s) => ({
    ...s,
    ideas: s.ideas.map((it) =>
      it.id === ideaId ? { ...it, rating: it.rating === rating ? null : rating || null } : it,
    ),
  }));
}
export function setIdeaNote(trip: Trip, destinationId: string, ideaId: string, notes: string): Trip {
  return updateDestination(trip, destinationId, (s) => ({
    ...s,
    ideas: s.ideas.map((it) => (it.id === ideaId ? { ...it, notes } : it)),
  }));
}
/**
 * The row Locate's optimistic half (#69): the place the picker chose, applied
 * to one idea. It takes the SAME `Place | null` the PATCH body carries, so the
 * screen and the row cannot disagree about what was sent — and `null` clears
 * the place here exactly as an explicit `null` clears the four columns.
 */
export function setIdeaPlace(
  trip: Trip,
  destinationId: string,
  ideaId: string,
  place: Place | null,
): Trip {
  return updateDestination(trip, destinationId, (s) => ({
    ...s,
    ideas: s.ideas.map((it) => (it.id === ideaId ? { ...it, place } : it)),
  }));
}

/** Splice the idea `POST /api/ideas` just created onto the destination. */
export function appendIdea(trip: Trip, destinationId: string, i: Idea): Trip {
  return updateDestination(trip, destinationId, (s) => ({ ...s, ideas: [...s.ideas, i] }));
}

/** The other leaf delete — same shape, same undo. */
export function removeIdea(trip: Trip, destinationId: string, ideaId: string): Trip {
  return updateDestination(trip, destinationId, (s) => ({
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
 * the row locally and hardcode the activity type.)
 */
export function applyPromotion(
  trip: Trip,
  destinationId: string,
  ideaId: string,
  r: Reservation,
): Trip {
  return updateDestination(trip, destinationId, (s) => ({
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
 * Assign dates to a floating destination.
 *
 * `gap` is the open span it was DROPPED on — the same `TimelineGap` the gantt's
 * `OpenLane` rendered, so `startCol` is a 1-based column into the very day list
 * `deriveDays` builds here. The destination takes the gap's first date and
 * `min(nights, gap.span)` days of it; a 1-day gap therefore yields
 * `arrive === depart`, a legal single-day destination.
 *
 * `gap === null` — the destination sheet's "Schedule" button, which has no drop target
 * — keeps the original behaviour: the LARGEST open run. It is the default, so
 * every existing two-argument call site is unchanged.
 */
export function scheduleFloating(
  trip: Trip,
  destinationId: string,
  gap: TimelineGap | null = null,
  nights = 3,
): Trip {
  const dates = spanDates(trip, gap, nights);
  if (!dates) return trip;
  return withReconciledSegments(updateDestination(trip, destinationId, (s) => ({ ...s, ...dates })));
}

/** The dates a drop lands on, or null when there is nothing to land on. */
export interface PlannedDates {
  arriveDate: IsoDate;
  departDate: IsoDate;
}

/**
 * The ONE date rule both drops share. `gap` is the open span that was dropped
 * on; `null` is the destination sheet's "Schedule" button, which has no drop target
 * and falls back to the trip's longest open run.
 */
function spanDates(trip: Trip, gap: TimelineGap | null, nights: number): PlannedDates | null {
  const { days } = deriveDays(trip, allDestinations(trip), trip.segments);

  let start: number;
  let runLen: number;
  if (gap) {
    start = gap.startCol - 1;
    // A gap the trip no longer has (the window moved under the drag) is a
    // no-op rather than a guess.
    if (start < 0 || start >= days.length) return null;
    runLen = Math.min(gap.span, days.length - start);
  } else {
    [start, runLen] = longestOpenRun(days);
    if (start < 0) return null;
  }
  if (runLen < 1) return null;

  const span = Math.min(nights, runLen);
  const arriveDate = days[start]!.date;
  return { arriveDate, departDate: addDays(arriveDate, span - 1) };
}

/**
 * A stay-idea dropped on an open span (#80 Q3 → A): the dates the destination that
 * drop CREATES is born with.
 *
 * It is `scheduleFloating`'s rule, not a second one — both call `spanDates`, so
 * a drop on the Oct 18–24 span yields Oct 18 – 20 for an idea exactly as it
 * does for a floating destination. Q3's answer is "identical to the floating-destination
 * drop"; this is what identical means.
 */
export function planIdeaOnGap(
  trip: Trip,
  gap: TimelineGap,
  nights = 3,
): PlannedDates | null {
  return spanDates(trip, gap, nights);
}

/** Reorder a floating destination within its chapter (dragged before target). */
export function reorderFloating(
  trip: Trip,
  chapterId: string,
  draggedId: string,
  targetId: string,
): Trip {
  if (draggedId === targetId) return trip;
  return withReconciledSegments(mapChapters(trip, (l) => {
    if (l.id !== chapterId) return l;
    const scheduled = l.destinations
      .filter(isScheduled)
      .sort((a, b) => a.arriveDate!.localeCompare(b.arriveDate!));
    const floats = l.destinations
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
      destinations: l.destinations.map((s) => ({ ...s, sortOrder: orderedIds.indexOf(s.id) })),
    };
  }));
}


// ── chapter + destination structure (pure; return a new Trip) ─────────────────────────
//
// Every helper here that can change the ROUTE SEQUENCE also re-runs
// `reconcileSegments` (#110 §6) — the same function the server persists in the
// same transaction — so the optimistic rhythm never paints a stale hop, and a
// new hop is born in the trip's default mode exactly as the server will write it.
//
// The row menus in the route lens. A CREATE is the one write with nothing to
// be optimistic about — only the server can mint the id — so the two `append`
// helpers take the row the 201 handed back; everything else here is applied
// optimistically, and its caller keeps the pre-change trip as the snapshot a
// failed write rolls back to.

/** Splice the chapter `POST /api/chapters` just created onto the end of the trip. */
export function appendChapter(trip: Trip, chapter: Chapter): Trip {
  return { ...trip, chapters: [...trip.chapters, chapter] };
}

/** Splice the destination `POST /api/destinations` just created into the chapter it belongs to. */
export function appendDestination(trip: Trip, destination: Destination): Trip {
  return withReconciledSegments(
    mapChapters(trip, (l) => (l.id === destination.chapterId ? { ...l, destinations: [...l.destinations, destination] } : l)),
  );
}

/** The chapter header's inline rename. */
export function renameChapter(trip: Trip, chapterId: string, title: string): Trip {
  return mapChapters(trip, (l) => (l.id === chapterId ? { ...l, title } : l));
}

/**
 * The destination row's inline rename. It edits the NAME only — the coordinates and
 * the Google id are what the place picker owns (#60), not a text field.
 */
export function renameDestination(trip: Trip, destinationId: string, name: string): Trip {
  return updateDestination(trip, destinationId, (s) => ({ ...s, place: { ...s.place, name } }));
}

/**
 * The destination directly ABOVE this one in the route list — the picker's search
 * bias. It reads the same `orderedChapterDestinations` sequence the route lens renders, so
 * "the destination above" means the row you can see above, not a sortOrder nobody
 * draws. Null for the first destination of a chapter, where home base takes over.
 */
export function destinationAbove(trip: Trip, destinationId: string): Destination | null {
  for (const chapter of trip.chapters) {
    const ordered = orderedChapterDestinations(chapter.destinations);
    const i = ordered.findIndex((s) => s.id === destinationId);
    if (i > 0) return ordered[i - 1]!;
    if (i === 0) return null;
  }
  return null;
}

/**
 * "Change place…" / "Set place" — the whole place at once, which is the one
 * thing a rename can never do. It REPLACES the place rather than merging into
 * it, so re-picking a coordless name honestly clears the old coordinates
 * instead of leaving a pin at the last spot with the new label.
 */
export function setDestinationPlace(trip: Trip, destinationId: string, place: Place): Trip {
  return updateDestination(trip, destinationId, (s) => ({ ...s, place }));
}

/** Delete a chapter. Its destinations go with it, the way the FK cascade does server-side. */
export function removeChapter(trip: Trip, chapterId: string): Trip {
  return withReconciledSegments({ ...trip, chapters: trip.chapters.filter((l) => l.id !== chapterId) });
}

/** Delete a destination. Its reservations and ideas go with it. */
export function removeDestination(trip: Trip, destinationId: string): Trip {
  return withReconciledSegments(
    mapChapters(trip, (l) => ({ ...l, destinations: l.destinations.filter((s) => s.id !== destinationId) })),
  );
}

/** The chapter ids in render order — the whole new order `reorder` POSTs. */
export function chapterOrder(trip: Trip): string[] {
  return [...trip.chapters].sort((a, b) => a.sortOrder - b.sortOrder).map((l) => l.id);
}

/** Is there a chapter on that side to swap with? (The menu item is disabled if not.) */
export function canMoveChapter(trip: Trip, chapterId: string, delta: -1 | 1): boolean {
  const order = chapterOrder(trip);
  const from = order.indexOf(chapterId);
  return from >= 0 && from + delta >= 0 && from + delta < order.length;
}

/**
 * "Move chapter up/down". Every chapter is renumbered from its new position, so a
 * half-applied swap can never leave two chapters sharing a sortOrder — the same
 * shape the server's one-transaction renumber uses.
 */
export function moveChapter(trip: Trip, chapterId: string, delta: -1 | 1): Trip {
  if (!canMoveChapter(trip, chapterId, delta)) return trip;
  const order = chapterOrder(trip);
  const from = order.indexOf(chapterId);
  const [moved] = order.splice(from, 1);
  order.splice(from + delta, 0, moved!);
  return withReconciledSegments({
    ...trip,
    chapters: trip.chapters.map((l) => ({ ...l, sortOrder: order.indexOf(l.id) })),
  });
}

/**
 * "Move to chapter". The destination is re-parented and appended to the end of the
 * area — the same "the server appends" rule a create follows, so the
 * optimistic tree and the row the PATCH writes agree.
 */
export function moveDestinationToChapter(trip: Trip, destinationId: string, chapterId: string): Trip {
  const moving = destinationMap(trip).get(destinationId);
  if (!moving || moving.chapterId === chapterId) return trip;
  const highest = trip.chapters
    .find((l) => l.id === chapterId)
    ?.destinations.reduce((n, s) => Math.max(n, s.sortOrder), -1);
  if (highest === undefined) return trip;
  const moved: Destination = { ...moving, chapterId, sortOrder: highest + 1 };
  return withReconciledSegments(
    mapChapters(trip, (l) => {
      if (l.id === moving.chapterId) return { ...l, destinations: l.destinations.filter((s) => s.id !== destinationId) };
      if (l.id === chapterId) return { ...l, destinations: [...l.destinations, moved] };
      return l;
    }),
  );
}

/** The destination-dates dialog, and "Unschedule" — which is both dates going null. */
export function setDestinationDates(
  trip: Trip,
  destinationId: string,
  arriveDate: IsoDate | null,
  departDate: IsoDate | null,
): Trip {
  return withReconciledSegments(
    updateDestination(trip, destinationId, (s) => ({ ...s, arriveDate, departDate })),
  );
}
