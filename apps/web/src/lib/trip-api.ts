import type {
  Idea,
  IdeaCreateInput,
  IdeaStatus,
  LatLng,
  Leg,
  LegCreateInput,
  LegPatchInput,
  LocateResponse,
  LocateRow,
  PlacesEnvelope,
  Reservation,
  ReservationCreateInput,
  ReservationPatchInput,
  ReservationType,
  RigProfileInput,
  SavedPlace,
  SavedPlaceCreateInput,
  SavedPlacePatch,
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

  /**
   * The Places library's writes (docs/design/41 §3). They go through `req` like
   * every other mutation — the library is our own data, so a failure is a real
   * error to surface, not the picker's renderable degraded envelope.
   *
   * `savePlace` is also how a "Been there?" suggestion is accepted: POST with
   * `status: "been"`, because the library row does not exist yet.
   * `updatePlace` covers the edit sheet AND the graduation want → been (the
   * server clears `source` on any patch that sets `status: "been"`).
   */
  savePlace: (input: SavedPlaceCreateInput): Promise<SavedPlace> =>
    req(`/api/places`, "POST", input) as Promise<SavedPlace>,

  updatePlace: (id: string, patch: SavedPlacePatch) =>
    req(`/api/places/${id}`, "PATCH", patch),

  deletePlace: (id: string) => req(`/api/places/${id}`, "DELETE"),

  /**
   * Locate — the bounded coordinate backfill (docs/design/41 §6). Ids only on
   * the way in; the route re-reads each row's name and region under the
   * owner's scope, so nothing here carries a name. At most `LOCATE_MAX_ROWS`
   * rows per call, and the caller slices to that before it presses.
   *
   * Through `req` like the library's other writes: this is our own data, so a
   * failure is a real error to surface, not a renderable degraded envelope. A
   * row Google cannot place is not a failure — it comes back in
   * `stillUnmapped` on a 200.
   */
  locatePlaces: (rows: LocateRow[]): Promise<LocateResponse> =>
    req(`/api/places/locate`, "POST", { rows }) as Promise<LocateResponse>,

  /**
   * Place search for the picker (docs/design/41 §3). Deliberately NOT through
   * `req`: the throttled answer is a 429 whose body is the real, renderable
   * degraded envelope (`places-search.ts:placesEnvelopeStatus`), and `req`
   * throws on !ok. Any other failure — offline, a proxy, a non-JSON body — is
   * reported as the same degraded shape, so the picker has exactly one shape
   * to render and never a thrown error to catch.
   */
  searchPlaces: async (q: string, near?: LatLng | null): Promise<PlacesEnvelope> => {
    const params = new URLSearchParams({ q });
    if (near) params.set("near", `${near.lat},${near.lng}`);
    try {
      const res = await fetch(`/api/places/search?${params}`);
      const body = (await res.json()) as PlacesEnvelope;
      if (!Array.isArray(body?.results)) throw new Error("not an envelope");
      return body;
    } catch {
      return { results: [], degraded: true, reason: "upstream_error" };
    }
  },
};
