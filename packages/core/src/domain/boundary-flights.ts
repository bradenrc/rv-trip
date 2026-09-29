import { hopBookingInput, hopDraftZones, bookingLocalTimes, type HopBookingDraft } from "./hops";
import { orderedStops, type RouteStop } from "./route-order";
import type {
  BoundaryBooking,
  BoundaryFlightsBody,
  IsoDate,
  Reservation,
  ReservationPatchInput,
  Segment,
  TravelMode,
  Trip,
} from "./types";

/**
 * #129 · Q10 A — Add flight with Round trip on, and #124's Edit on a hop
 * booking. Pure; the web's Add flight sheet and the phone's run the same
 * functions, and the server's `createBoundaryFlights` reads the same hop set.
 */

/** Structural, so the server's bare `SegmentTrip` and a full `Trip` both fit. */
interface BoundaryTrip {
  id: string;
  defaultMode: TravelMode;
  legs: { sortOrder: number; stops: RouteStop[] }[];
  segments: Segment[];
}

/** The trip's two boundary hops: home → first stop, and last stop → home. */
export function boundarySegments(trip: Pick<Trip, "segments">): {
  outbound: Segment | null;
  return: Segment | null;
} {
  return {
    outbound: trip.segments.find((s) => s.fromStopId === null && s.toStopId !== null) ?? null,
    return: trip.segments.find((s) => s.toStopId === null && s.fromStopId !== null) ?? null,
  };
}

/**
 * The trip with a → home hop from its last stop when it has none — the ONE
 * place a return hop is born (vet HIGH: `reconcileSegments` never invents one).
 * Trip create (with a destination) and the round-trip save run it; once it
 * exists, `reconcileSegments` re-points it to whatever stop is last.
 */
export function withReturnHop<T extends BoundaryTrip>(trip: T, newId: () => string): T {
  const stops = orderedStops(trip);
  const last = stops[stops.length - 1];
  if (!last || boundarySegments(trip).return) return trip;
  const hop: Segment = {
    id: newId(),
    tripId: trip.id,
    fromStopId: last.id,
    toStopId: null,
    mode: trip.defaultMode,
    departAt: null,
    arriveAt: null,
    departTz: null,
    arriveTz: null,
    sortOrder: trip.segments.length,
    reservations: [],
  };
  return { ...trip, segments: [...trip.segments, hop] };
}

/**
 * The return leg's opening state (frame 6): the outbound's airports MIRRORED
 * (and their picked zones with them), dated the trip's last day — the human
 * types the flight number and the two times. "Edit either later."
 */
export function mirrorReturnDraft(out: HopBookingDraft, returnDate: IsoDate): HopBookingDraft {
  return {
    kind: out.kind,
    label: "",
    from: out.to,
    to: out.from,
    departs: `${returnDate} `,
    arrives: `${returnDate} `,
    fromZone: out.toZone,
    toZone: out.fromZone,
  };
}

/** A draft as the boundary body's booking, or null while it is not savable. */
export function boundaryBookingOf(d: HopBookingDraft): BoundaryBooking | null {
  const body = hopBookingInput("boundary", d, hopDraftZones(d));
  if (!body || !body.startsAt || !body.endsAt || !body.startsTz || !body.endsTz) return null;
  return {
    name: body.name,
    startsAt: body.startsAt,
    endsAt: body.endsAt,
    startsTz: body.startsTz,
    endsTz: body.endsTz,
    confirmationNumber: null,
    cost: null,
  };
}

/**
 * The `POST /api/trips/:id/boundary-flights` body, or null — the same null
 * "Save both flights" is disabled on. Round trip on needs BOTH legs savable;
 * off sends the outbound alone.
 */
export function boundaryFlightsBody(
  roundTrip: boolean,
  out: HopBookingDraft,
  ret: HopBookingDraft | null,
): BoundaryFlightsBody | null {
  const outbound = boundaryBookingOf(out);
  if (!outbound) return null;
  if (!roundTrip) return { roundTrip: false, outbound, return: null };
  const back = ret ? boundaryBookingOf(ret) : null;
  if (!back) return null;
  return { roundTrip: true, outbound, return: back };
}

/**
 * #124 · Edit on a hop booking: the form's state seeded from the stored row.
 * The name is the form's own shape read back ("AS 2291 BOI→BLI" → label
 * "AS 2291", from "BOI", to "BLI"); the stored zones become PICKED zones, so the
 * form keeps exactly the clock the ticket was saved with.
 */
export function hopDraftFromBooking(r: Reservation, kind: HopBookingDraft["kind"]): HopBookingDraft {
  const m = /^(.*)\s+(\S+)→(\S+)$/.exec(r.name.trim());
  const { departs, arrives } = bookingLocalTimes(r);
  return {
    kind,
    label: m ? m[1]!.trim() : r.name,
    from: m ? m[2]! : "",
    to: m ? m[3]! : "",
    departs,
    arrives,
    fromZone: r.startsTz,
    toZone: r.endsTz,
  };
}

/** The `PATCH /api/reservations/:id` body for an edited hop booking — only
 * what moved. `{}` when nothing did. */
export function hopBookingPatch(
  r: Reservation,
  next: Pick<Reservation, "name" | "startsAt" | "endsAt" | "startsTz" | "endsTz">,
): ReservationPatchInput {
  const patch: ReservationPatchInput = {};
  if (next.name !== r.name) patch.name = next.name;
  const sameInstant = (a: string | null, b: string | null) =>
    a === b || (a !== null && b !== null && Date.parse(a) === Date.parse(b));
  if (!sameInstant(next.startsAt, r.startsAt) || next.startsTz !== r.startsTz) {
    patch.startsAt = next.startsAt;
    patch.startsTz = next.startsTz;
  }
  if (!sameInstant(next.endsAt, r.endsAt) || next.endsTz !== r.endsTz) {
    patch.endsAt = next.endsAt;
    patch.endsTz = next.endsTz;
  }
  return patch;
}
