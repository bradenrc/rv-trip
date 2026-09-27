import {
  instantToLocalInput,
  localToInstant,
  zoneForAirport,
  zoneNearPoint,
} from "./airports";
import { newSegmentDateConflicts, type SegmentDateConflict } from "./segments";
import type {
  IsoDate,
  Place,
  Reservation,
  ReservationCreateInput,
  Segment,
  Stop,
  TravelMode,
  Trip,
} from "./types";

/**
 * A hop's bookings (#104) — flights and ferries entered on the hop between two
 * stops, in local time. Pure, and run on BOTH sides: the server's
 * `createReservation` re-times the segment and judges the date clash with
 * these functions, and the web and the phone run the very same ones on the
 * draft trip so the amber message appears before the POST (Q8 A).
 */

// ── the segment's clock follows its bookings ───────────────────────────────

/** The slice of a booking the segment's clock is read from. */
export interface TimedBooking {
  startsAt: string | null;
  endsAt: string | null;
  startsTz: string | null;
  endsTz: string | null;
}

type SegmentClock = Pick<Segment, "departAt" | "arriveAt" | "departTz" | "arriveTz">;

/**
 * The segment re-timed from its bookings: it departs when the EARLIEST booking
 * leaves and arrives when the LATEST one lands, each in that booking's zone —
 * exactly how the Costa Rica seed's `seg_out` is timed from AA 2451 and
 * AA 2208. A segment with no timed booking keeps the clock it has (the seed's
 * `seg_home` is timed with no flights on it).
 */
export function retimedSegment<S extends SegmentClock>(seg: S, bookings: TimedBooking[]): S {
  const leaves = bookings.filter((b) => b.startsAt !== null && b.startsTz !== null);
  const lands = bookings.filter((b) => b.endsAt !== null && b.endsTz !== null);
  if (leaves.length === 0 || lands.length === 0) return seg;
  const first = leaves.reduce((a, b) => (Date.parse(b.startsAt!) < Date.parse(a.startsAt!) ? b : a));
  const last = lands.reduce((a, b) => (Date.parse(b.endsAt!) > Date.parse(a.endsAt!) ? b : a));
  return {
    ...seg,
    departAt: new Date(first.startsAt!).toISOString(),
    departTz: first.startsTz,
    arriveAt: new Date(last.endsAt!).toISOString(),
    arriveTz: last.endsTz,
  };
}

// ── the clash, and the "move the stop" fix ─────────────────────────────────

/** A trip shaped enough for the clash check — the domain `Trip` qualifies. */
type ClashTrip = Pick<Trip, "id" | "homeBase" | "defaultMode" | "legs" | "segments">;

/**
 * Which side of a stop a hop's clash is on. A hop going HOME is judged against
 * the stop it leaves (its check-out); every other hop against the stop it
 * lands at (its check-in) — `segmentDateConflicts`' own two rules.
 */
export type ClashSide = "checkout" | "checkin";

export interface HopClash {
  conflict: SegmentDateConflict;
  side: ClashSide;
  stopId: string;
  stopName: string;
}

/** The trip with one more booking on a hop, and that hop re-timed from it. */
export function withSegmentBooking<T extends ClashTrip>(trip: T, segmentId: string, r: Reservation): T {
  return {
    ...trip,
    segments: trip.segments.map((s) =>
      s.id === segmentId ? retimedSegment({ ...s, reservations: [...s.reservations, r] }, [...s.reservations, r]) : s,
    ),
  };
}

/**
 * The clash a new booking on a hop would INTRODUCE, or null. Same rule the
 * server enforces with 409 `segment_date_mismatch`: stop dates win, and a
 * conflict that predates the booking is not this booking's fault.
 */
export function hopBookingClash(trip: ClashTrip, segmentId: string, body: TimedBooking): HopClash | null {
  const seg = trip.segments.find((s) => s.id === segmentId);
  if (!seg) return null;
  const after = {
    ...trip,
    segments: trip.segments.map((s) => (s.id === segmentId ? retimedSegment(s, [...s.reservations, body]) : s)),
  };
  const conflict = newSegmentDateConflicts(trip, after).find((c) => c.segmentId === segmentId);
  return conflict ? clashOf(trip, seg, conflict) : null;
}

/** Name the stop a conflict is about, and which of its dates. */
export function clashOf(
  trip: { legs: { stops: { id: string; place?: { name: string } }[] }[] },
  seg: Pick<Segment, "fromStopId" | "toStopId">,
  conflict: SegmentDateConflict,
): HopClash | null {
  const side: ClashSide = seg.toStopId === null ? "checkout" : "checkin";
  const stopId = side === "checkout" ? seg.fromStopId : seg.toStopId;
  const stop = trip.legs.flatMap((l) => l.stops).find((s) => s.id === stopId);
  if (!stop) return null;
  // The server judges a bare hop set with no names; the name is copy only.
  return { conflict, side, stopId: stop.id, stopName: stop.place?.name ?? "" };
}

/**
 * Q8 A's first fix — the stop's date the booking moves: a check-out for a hop
 * home, a check-in otherwise, set to the booking's own local date.
 */
export function clashStopPatch(
  clash: Pick<HopClash, "side" | "conflict">,
): { arriveDate: IsoDate } | { departDate: IsoDate } {
  return clash.side === "checkout"
    ? { departDate: clash.conflict.actual }
    : { arriveDate: clash.conflict.actual };
}

/**
 * The stop re-dated by the fix — and its own stay moved WITH it, so the stay
 * card and the stop never disagree (vet MED c): a campground/lodging row whose
 * check-out was the stop's old check-out follows it (and the check-in, for a
 * check-in move).
 */
export function movedStop(stop: Stop, clash: Pick<HopClash, "side" | "conflict">): Stop {
  const { expected, actual } = clash.conflict;
  const stay = (r: Reservation) => r.stopId === stop.id && (r.type === "campground" || r.type === "lodging");
  if (clash.side === "checkout") {
    return {
      ...stop,
      departDate: actual,
      reservations: stop.reservations.map((r) =>
        stay(r) && r.checkOut === expected ? { ...r, checkOut: actual } : r,
      ),
    };
  }
  return {
    ...stop,
    arriveDate: actual,
    reservations: stop.reservations.map((r) =>
      stay(r) && r.checkIn === expected ? { ...r, checkIn: actual } : r,
    ),
  };
}

/** A clash's move is legal only while the stop stays a forward range. */
export function clashMoveIsValid(stop: Pick<Stop, "arriveDate" | "departDate">, clash: HopClash): boolean {
  const patch = clashStopPatch(clash);
  const arrive = "arriveDate" in patch ? patch.arriveDate : stop.arriveDate;
  const depart = "departDate" in patch ? patch.departDate : stop.departDate;
  return arrive === null || depart === null || arrive <= depart;
}

/** "01/23" — the clash sentence's date, as the design prints it. */
export function monthSlashDay(d: IsoDate): string {
  return `${d.slice(5, 7)}/${d.slice(8, 10)}`;
}

/** The amber message's four strings (Q8 A). */
export interface ClashCopy {
  headline: string;
  sub: string;
  move: string;
  keep: string;
}

export function hopClashCopy(clash: HopClash, kind: HopBookingKind): ClashCopy {
  const noun = kind === "ferry" ? "ferry" : "flight";
  const { expected, actual } = clash.conflict;
  const stop = clash.stopName;
  return clash.side === "checkout"
    ? {
        headline: `This ${noun} leaves ${monthSlashDay(actual)}, but ${stop} runs to ${monthSlashDay(expected)}.`,
        sub: "Stop dates win, so nothing is saved until they agree.",
        move: `Check out of ${stop} on ${monthSlashDay(actual)} instead`,
        keep: `Keep the stop, and fix the ${noun} date`,
      }
    : {
        headline: `This ${noun} lands ${monthSlashDay(actual)}, but ${stop} starts ${monthSlashDay(expected)}.`,
        sub: "Stop dates win, so nothing is saved until they agree.",
        move: `Check in to ${stop} on ${monthSlashDay(actual)} instead`,
        keep: `Keep the stop, and fix the ${noun} date`,
      };
}

/**
 * The trip after a booking landed — what the web and the phone splice in on
 * the 201. With `move` it is the one-request fix: the stop's date and its own
 * stay moved in the same breath, exactly as the server wrote them.
 */
export function applyHopBooking<T extends ClashTrip>(trip: T, r: Reservation, move: boolean): T {
  if (!r.segmentId) return trip;
  const clash = move ? hopBookingClash(trip, r.segmentId, r) : null;
  const next = withSegmentBooking(trip, r.segmentId, r);
  if (!clash) return next;
  return {
    ...next,
    legs: next.legs.map((l) => ({
      ...l,
      stops: l.stops.map((s) => (s.id === clash.stopId ? movedStop(s, clash) : s)),
    })),
  };
}

/** A booking removed from its hop, and the hop re-timed from what is left (a
 * hop left with no timed booking keeps its clock — see `retimedSegment`). */
export function removeSegmentBooking<T extends Pick<Trip, "segments">>(trip: T, resId: string): T {
  return {
    ...trip,
    segments: trip.segments.map((s) => {
      if (!s.reservations.some((r) => r.id === resId)) return s;
      const rest = s.reservations.filter((r) => r.id !== resId);
      return retimedSegment({ ...s, reservations: rest }, rest);
    }),
  };
}

/** The mode switch, applied optimistically (`PATCH /api/segments/:id`). A hop
 * switched to Drive drops its clock too — the server does the same. */
export function setSegmentMode<T extends Pick<Trip, "segments">>(trip: T, segmentId: string, mode: TravelMode): T {
  return {
    ...trip,
    segments: trip.segments.map((s) =>
      s.id !== segmentId
        ? s
        : mode === "drive"
          ? { ...s, mode, departAt: null, arriveAt: null, departTz: null, arriveTz: null }
          : { ...s, mode },
    ),
  };
}

// ── the Add flight / Add ferry form ────────────────────────────────────────

export type HopBookingKind = "flight" | "ferry";

/**
 * What the form holds — every field a string, the way an input holds it.
 * `label` is the flight number or the ferry operator. `from`/`to` are airport
 * codes for a flight and the hop's two port names (read-only) for a ferry.
 * `fromZone`/`toZone` are a zone the human PICKED; null means "take it from
 * the code" (Q6 A).
 */
export interface HopBookingDraft {
  kind: HopBookingKind;
  label: string;
  from: string;
  to: string;
  /** "YYYY-MM-DD HH:MM", local to its end. */
  departs: string;
  arrives: string;
  fromZone: string | null;
  toZone: string | null;
}

/** The form's opening state. A ferry's ports are the hop's two stops. */
export function blankHopDraft(kind: HopBookingKind, ports: { from: string; to: string } | null = null): HopBookingDraft {
  return {
    kind,
    label: "",
    from: kind === "ferry" ? (ports?.from ?? "") : "",
    to: kind === "ferry" ? (ports?.to ?? "") : "",
    departs: "",
    arrives: "",
    fromZone: null,
    toZone: null,
  };
}

/** One zone chip. `verified` is the green state: the TABLE knew this code —
 * never a zone the human picked, and never a guess. */
export interface ZoneChip {
  zone: string | null;
  verified: boolean;
  /** What the chip asks about when it has no zone ("XYZ"). */
  code: string;
}

/** The two chips. A flight reads each airport code; a ferry reads its port
 * stops' coordinates (the nearest listed airport's zone). */
export function hopDraftZones(
  d: HopBookingDraft,
  ports: { from: Place | null; to: Place | null } = { from: null, to: null },
): { from: ZoneChip; to: ZoneChip } {
  const auto = (code: string, port: Place | null): string | null => {
    if (d.kind === "flight") return code.trim() === "" ? null : zoneForAirport(code);
    return port && port.lat != null && port.lng != null ? zoneNearPoint(port.lat, port.lng) : null;
  };
  const chip = (code: string, port: Place | null, picked: string | null): ZoneChip => {
    const found = auto(code, port);
    return {
      zone: picked ?? found,
      verified: picked === null && found !== null,
      code: code.trim().toUpperCase(),
    };
  };
  return { from: chip(d.from, ports.from, d.fromZone), to: chip(d.to, ports.to, d.toZone) };
}

/** What a flight is called: "AA 1190 LIR→DFW" — the seed's own shape. A ferry:
 * "SeaJets Mykonos→Naxos". */
export function hopBookingName(d: HopBookingDraft): string {
  const label = d.label.trim();
  return d.kind === "flight"
    ? `${label} ${d.from.trim().toUpperCase()}→${d.to.trim().toUpperCase()}`
    : `${label} ${d.from.trim()}→${d.to.trim()}`;
}

/**
 * The `POST /api/reservations` body for the hop, or null while the form is not
 * submittable — the same null Save is disabled on. Not submittable: no label,
 * a flight with no codes, EITHER end without a zone (Q6 A: "Save stays
 * disabled until both ends have a zone"), a time that is not a wall clock, or
 * a booking that lands before it leaves.
 */
export function hopBookingInput(
  segmentId: string,
  d: HopBookingDraft,
  zones: { from: ZoneChip; to: ZoneChip },
): ReservationCreateInput | null {
  if (d.label.trim() === "") return null;
  if (d.from.trim() === "" || d.to.trim() === "") return null;
  const fromZone = zones.from.zone;
  const toZone = zones.to.zone;
  if (!fromZone || !toZone) return null;
  const startsAt = localToInstant(d.departs, fromZone);
  const endsAt = localToInstant(d.arrives, toZone);
  if (!startsAt || !endsAt) return null;
  if (Date.parse(endsAt) < Date.parse(startsAt)) return null;
  return {
    segmentId,
    type: "transport",
    name: hopBookingName(d),
    checkIn: null,
    checkOut: null,
    confirmationNumber: null,
    cost: null,
    rating: null,
    notes: null,
    startsAt,
    endsAt,
    startsTz: fromZone,
    endsTz: toZone,
    lodgingKind: null,
  };
}

/**
 * Q8 A's second fix — "Keep the stop, and fix the flight date": both of the
 * form's dates move by the clash's gap, so the booking lands on the stop's
 * date. Nothing is saved; the human still presses Save.
 */
export function fixHopDraftDates(d: HopBookingDraft, clash: HopClash): HopBookingDraft {
  const days = dayGap(clash.conflict.actual, clash.conflict.expected);
  return { ...d, departs: shiftLocal(d.departs, days), arrives: shiftLocal(d.arrives, days) };
}

function dayGap(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function shiftLocal(local: string, days: number): string {
  const m = /^(\d{4}-\d{2}-\d{2})(.*)$/.exec(local.trim());
  if (!m) return local;
  const d = new Date(`${m[1]}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.toISOString().slice(0, 10)}${m[2]}`;
}

/** A timed booking as its form would hold it — the ticket's wall clock. */
export function bookingLocalTimes(r: TimedBooking): { departs: string; arrives: string } {
  return {
    departs: r.startsAt && r.startsTz ? instantToLocalInput(r.startsAt, r.startsTz) : "",
    arrives: r.endsAt && r.endsTz ? instantToLocalInput(r.endsAt, r.endsTz) : "",
  };
}
