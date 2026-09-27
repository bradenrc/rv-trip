import { useCallback, useEffect, useSyncExternalStore } from "react";
import type {
  NearbySave,
  NearbySaves,
  Reservation,
  ReservationCreateInput,
  TravelMode,
  TripCreateInput,
  TripPatchInput,
  SavedPlace,
  SavedPlacePatch,
  SurfaceRadiusMi,
  Trip,
  TripSummary,
} from "@rv-trip/core";
import {
  appendReservation,
  appendShelfIdea,
  applyHopBooking,
  applySavedPlacePatch,
  nearbyIdeaBody,
  setSegmentMode,
  withReconciledSegments,
} from "@rv-trip/core";
import type { TripBundle } from "@rv-trip/core/api-client";
import { api } from "./api";

/**
 * A tiny in-memory store: the last-fetched trip bundles and the trips list,
 * read through useSyncExternalStore so a rating set on the stop screen shows
 * on the trip screen behind it without a refetch. Nothing persists — offline
 * is out of scope for v1 (spec §Decisions).
 */
interface State {
  trips: TripSummary[] | null;
  /** The Saves tab's library, both shelves (#111 i2). */
  saves: SavedPlace[] | null;
  bundles: Record<string, TripBundle>;
  /** Each trip's nearby saves (#111 i3) — the banner and the review sheet. */
  nearby: Record<string, NearbySaves>;
  errors: Record<string, string>;
}

let state: State = { trips: null, saves: null, bundles: {}, nearby: {}, errors: {} };
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  for (const l of listeners) l();
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function loadTrips(): Promise<void> {
  try {
    const trips = await api.trips.list();
    set({ ...state, trips, errors: { ...state.errors, trips: "" } });
  } catch (e) {
    set({ ...state, errors: { ...state.errors, trips: message(e) } });
  }
}

export async function loadBundle(id: string): Promise<void> {
  try {
    const bundle = await api.trips.get(id);
    set({ ...state, bundles: { ...state.bundles, [id]: bundle }, errors: { ...state.errors, [id]: "" } });
  } catch (e) {
    set({ ...state, errors: { ...state.errors, [id]: message(e) } });
  }
}

/** Optimistic local edit of a loaded trip (the same pure helpers the web uses). */
export function updateTrip(id: string, fn: (t: Trip) => Trip): void {
  const b = state.bundles[id];
  if (!b) return;
  set({ ...state, bundles: { ...state.bundles, [id]: { ...b, trip: fn(b.trip) } } });
}

export function useTrips() {
  const trips = useSyncExternalStore(subscribe, () => state.trips);
  const error = useSyncExternalStore(subscribe, () => state.errors.trips ?? "");
  useEffect(() => {
    if (trips === null) void loadTrips();
  }, [trips]);
  const reload = useCallback(() => loadTrips(), []);
  return { trips, error, reload };
}

export function useBundle(id: string) {
  const bundle = useSyncExternalStore(subscribe, () => state.bundles[id] ?? null);
  const error = useSyncExternalStore(subscribe, () => state.errors[id] ?? "");
  useEffect(() => {
    if (!bundle) void loadBundle(id);
  }, [id, bundle]);
  const reload = useCallback(() => loadBundle(id), [id]);
  return { bundle, error, reload };
}

// ── Saves (#111 i2) ──────────────────────────────────────────────────────────

export async function loadSaves(): Promise<void> {
  try {
    const saves = await api.places.list();
    set({ ...state, saves, errors: { ...state.errors, saves: "" } });
  } catch (e) {
    set({ ...state, errors: { ...state.errors, saves: message(e) } });
  }
}

/**
 * PATCH a save — the suggestion strip's upgrade and Dismiss. The row changes
 * at once through the web's own echo (`applySavedPlacePatch`); the PATCH
 * answers 204 with no body, so the library is then refetched for what only
 * the server knows (the upgrade's re-resolved destination). A refused write
 * is undone by the same refetch.
 */
export async function patchSave(id: string, patch: SavedPlacePatch): Promise<void> {
  if (state.saves) {
    set({ ...state, saves: state.saves.map((s) => (s.id === id ? applySavedPlacePatch(s, patch) : s)) });
  }
  try {
    await api.places.patch(id, patch);
  } finally {
    await loadSaves();
  }
}

export function useSaves() {
  const saves = useSyncExternalStore(subscribe, () => state.saves);
  const error = useSyncExternalStore(subscribe, () => state.errors.saves ?? "");
  useEffect(() => {
    if (saves === null) void loadSaves();
  }, [saves]);
  const reload = useCallback(() => loadSaves(), []);
  return { saves, error, reload };
}

// ── Trip surfacing (#111 i3) ─────────────────────────────────────────────────

/** Refetch a trip's nearby saves. A failure leaves the last answer (or none)
 * in place: the banner is a suggestion, never an error screen. */
export async function loadNearby(tripId: string): Promise<void> {
  try {
    const nearby = await api.trips.nearbySaves(tripId);
    set({ ...state, nearby: { ...state.nearby, [tripId]: nearby } });
  } catch {
    // quiet — no banner
  }
}

export function useNearby(tripId: string) {
  const nearby = useSyncExternalStore(subscribe, () => state.nearby[tripId] ?? null);
  useEffect(() => {
    void loadNearby(tripId);
  }, [tripId]);
  const reload = useCallback(() => loadNearby(tripId), [tripId]);
  return { nearby, reload };
}

/**
 * The banner's Dismiss: every save surfaced right now is remembered as
 * dismissed for this trip. The banner hides at once; the POST is then
 * confirmed by a refetch (which also restores it if the write was refused).
 */
export async function dismissNearby(tripId: string, saveIds: string[]): Promise<void> {
  const current = state.nearby[tripId];
  if (current) {
    set({ ...state, nearby: { ...state.nearby, [tripId]: { ...current, items: [] } } });
  }
  try {
    await api.trips.dismissSaves(tripId, saveIds);
  } finally {
    await loadNearby(tripId);
  }
}

/** A radius chip: the trip's `surface_radius_mi`, then the list at that radius. */
export async function setSurfaceRadius(tripId: string, radius: SurfaceRadiusMi): Promise<void> {
  updateTrip(tripId, (t) => ({ ...t, surfaceRadiusMi: radius }));
  try {
    await api.trips.patch(tripId, { surfaceRadiusMi: radius });
  } finally {
    await loadNearby(tripId);
  }
}

/** Add: copy the save into the trip's ideas (`POST /api/ideas`) and splice the
 * 201's idea onto the shelf the Route lens draws. Throws on a refusal so the
 * sheet can put its Add button back. */
export async function addNearbyIdea(tripId: string, item: NearbySave): Promise<void> {
  const created = await api.ideas.create(nearbyIdeaBody(tripId, item));
  updateTrip(tripId, (t) => appendShelfIdea(t, created));
}

// ── W2 (#112): setup, trip defaults, hops, stays ─────────────────────────────

/** The setup's Create trip (#103): POST, then the Trips list re-reads. */
export async function createTrip(input: TripCreateInput): Promise<Trip> {
  const trip = await api.trips.create(input);
  await loadTrips();
  return trip;
}

/** Trip defaults' Save — only what changed. The bundle is re-read after, so a
 * rig answer that moved re-routes the drives on the server (`tripRig`). */
export async function patchTripDefaults(id: string, patch: TripPatchInput): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  updateTrip(id, (t) => ({ ...t, ...patch }) as Trip);
  try {
    await api.trips.patch(id, patch);
  } finally {
    await Promise.all([loadBundle(id), loadTrips()]);
  }
}

/** A hop's mode switch (#104 · Q7 B), optimistic; a refusal re-reads the trip
 * (which puts the old mode back) and rethrows for the screen to say so. */
export async function setHopMode(tripId: string, segmentId: string, mode: TravelMode): Promise<void> {
  updateTrip(tripId, (t) => setSegmentMode(t, segmentId, mode));
  try {
    await api.segments.patch(segmentId, { mode });
  } catch (e) {
    await loadBundle(tripId);
    throw e;
  }
}

/** Save flight / Save ferry — with `moveStop`, the Q8 A "Check out of …
 * instead" fix in one request. Throws on a refusal (the sheet stays open). */
export async function addHopBooking(
  tripId: string,
  body: ReservationCreateInput,
  moveStop: boolean,
): Promise<Reservation> {
  const r = await api.reservations.create(moveStop ? { ...body, moveStop: true } : body);
  updateTrip(tripId, (t) => withReconciledSegments(applyHopBooking(t, r, moveStop)));
  return r;
}

/** Add stay (#105) — a stop-parented stay of a kind. */
export async function addStay(tripId: string, body: ReservationCreateInput): Promise<void> {
  const r = await api.reservations.create(body);
  if (r.stopId) updateTrip(tripId, (t) => appendReservation(t, r.stopId!, r));
}
