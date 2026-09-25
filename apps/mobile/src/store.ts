import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { SavedPlace, SavedPlacePatch, Trip, TripSummary } from "@rv-trip/core";
import { applySavedPlacePatch } from "@rv-trip/core";
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
  errors: Record<string, string>;
}

let state: State = { trips: null, saves: null, bundles: {}, errors: {} };
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
