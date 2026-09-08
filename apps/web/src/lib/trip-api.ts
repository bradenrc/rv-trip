import type {
  Idea,
  IdeaCreateInput,
  IdeaStatus,
  LatLng,
  Leg,
  LegCreateInput,
  LegPatchInput,
  Reservation,
  ReservationCreateInput,
  ReservationPatchInput,
  ReservationType,
  RigProfileInput,
  Stop,
  StopCreateInput,
  StopPatchInput,
  Trip,
  TripCreateInput,
  TripPatchInput,
} from "@rv-trip/core";
import type { RouteMap } from "./trip-logic";

async function req(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`);
  return res.status === 204 ? null : res.json();
}

export const tripApi = {
  /**
   * Create a trip. 201 carries the whole tree — including the one empty "Leg 1"
   * the create seeds — so the page can redirect straight into the planner.
   */
  createTrip: (input: TripCreateInput): Promise<Trip> =>
    req(`/api/trips`, "POST", input) as Promise<Trip>,

  /** The settings dialog. Send only what changed: an omitted key is left alone. */
  updateTrip: (id: string, patch: TripPatchInput) => req(`/api/trips/${id}`, "PATCH", patch),

  /** Legs, stops, reservations and ideas cascade with it. */
  deleteTrip: (id: string) => req(`/api/trips/${id}`, "DELETE"),

  /**
   * "Add leg". 201 carries the created leg (with an empty `stops`), because
   * only the server can mint the id — so this one write is not optimistic.
   */
  createLeg: (input: LegCreateInput): Promise<Leg> =>
    req(`/api/legs`, "POST", input) as Promise<Leg>,

  /** The leg header's inline rename. */
  updateLeg: (id: string, patch: LegPatchInput) => req(`/api/legs/${id}`, "PATCH", patch),

  /** Stops — and their reservations and ideas — cascade with it. */
  deleteLeg: (id: string) => req(`/api/legs/${id}`, "DELETE"),

  /** "Move leg up/down" sends the WHOLE new order, so the renumber is one
   * transaction and two legs can never end up sharing a sortOrder. */
  reorderLegs: (tripId: string, order: string[]) =>
    req(`/api/trips/${tripId}/legs/reorder`, "POST", { order }),

  /** "Add stop". 201 carries the created stop, for the same reason a leg does. */
  createStop: (input: StopCreateInput): Promise<Stop> =>
    req(`/api/stops`, "POST", input) as Promise<Stop>,

  /**
   * The widened stop write: rename (`placeName`), move (`legId`), reorder
   * (`sortOrder`), the dates (both null is "Unschedule") and rating/notes.
   * A 409 `stop_dates_outside_trip` comes back as a rejected promise like any
   * other non-2xx, so `persist()` rolls the optimistic change back.
   */
  updateStop: (id: string, patch: StopPatchInput) => req(`/api/stops/${id}`, "PATCH", patch),

  /** Reservations and ideas cascade with it. */
  deleteStop: (id: string) => req(`/api/stops/${id}`, "DELETE"),

  /**
   * "Add reservation" — and what an undone delete re-POSTs, which is why the
   * body is the whole row. 201 carries the created reservation, because only
   * the server can mint the id.
   */
  createReservation: (input: ReservationCreateInput): Promise<Reservation> =>
    req(`/api/reservations`, "POST", input) as Promise<Reservation>,

  /** The widened reservation write: the full field set, all optional — the edit
   * form sends what changed, the card's stars and note send one. */
  updateReservation: (id: string, patch: ReservationPatchInput) =>
    req(`/api/reservations/${id}`, "PATCH", patch),

  /** A leaf: no confirm dialog, an undo toast instead. */
  deleteReservation: (id: string) => req(`/api/reservations/${id}`, "DELETE"),

  /** "Add idea". 201 carries the created idea, for the same reason. */
  createIdea: (input: IdeaCreateInput): Promise<Idea> =>
    req(`/api/ideas`, "POST", input) as Promise<Idea>,

  updateIdea: (
    id: string,
    patch: { status?: IdeaStatus; rating?: number | null; notes?: string | null },
  ) => req(`/api/ideas/${id}`, "PATCH", patch),

  /** The other leaf. */
  deleteIdea: (id: string) => req(`/api/ideas/${id}`, "DELETE"),

  /** "Book" — the idea becomes a reservation of the type you picked, instead of
   * the "activity" the server used to hardcode. */
  promoteIdea: (id: string, type: ReservationType): Promise<Reservation> =>
    req(`/api/ideas/${id}/promote`, "POST", { type }) as Promise<Reservation>,

  reorderLeg: (legId: string, order: string[]) =>
    req(`/api/legs/${legId}/reorder`, "POST", { order }),

  /** The rig is a singleton at a fixed URL, so saving it is a PUT upsert. */
  saveRig: (input: RigProfileInput) => req(`/api/rig`, "PUT", input),

  /**
   * Route pairs the server never saw — the post-reorder upgrade. The reply
   * echoes the rig hash it keyed with, so the caller can tell "these are keyed
   * for your rig" from "the rig changed under you".
   */
  routePairs: (
    pairs: { from: LatLng; to: LatLng }[],
  ): Promise<{ rigHash: string; routes: RouteMap }> =>
    req(`/api/routes`, "POST", { pairs }) as Promise<{ rigHash: string; routes: RouteMap }>,
};
