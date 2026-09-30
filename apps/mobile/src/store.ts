import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  ForNextTime,
  Idea,
  NearbySave,
  NearbySaves,
  NextTimeRow,
  Reservation,
  ReservationCreateInput,
  BoundaryFlightsBody,
  SegmentBookingsChoice,
  TravelMode,
  TripCreateInput,
  TripPatchInput,
  SavedPlace,
  SavedPlacePatch,
  SurfaceRadiusMi,
  Trip,
  TripSummary,
  Place,
  IsoDate,
} from "@rv-trip/core";
import {
  appendReservation,
  appendShelfIdea,
  localIsoDate,
  markRowOnShelf,
  nextTimeIdeaBody,
  todaysStop,
  applyHopBooking,
  applySavedPlacePatch,
  nearbyIdeaBody,
  setSegmentMode,
  withReconciledSegments,
  appendStop,
  attachIdeaToStop,
  updateStop,
  legOrder,
} from "@rv-trip/core";
import { tripBundleSchema, type TripBundle } from "@rv-trip/core/api-client";
import { api } from "./api";
import { onQueueSent } from "./capture";

/**
 * A tiny in-memory store: the last-fetched trip bundles and the trips list,
 * read through useSyncExternalStore so a rating set on the stop screen shows
 * on the trip screen behind it without a refetch.
 *
 * #113 (Q5 A · vet HIGH "the Did-it chip has no data path"): the bundle of a
 * trip IN PROGRESS — its dates cover today — is persisted, so the capture
 * sheet can find today's stop and the stop screen can check things off with
 * no signal, even after a relaunch. Nothing else persists.
 */
interface State {
  trips: TripSummary[] | null;
  /** The Saves tab's library, both shelves (#111 i2). */
  saves: SavedPlace[] | null;
  bundles: Record<string, TripBundle>;
  /** Each trip's nearby saves (#111 i3) — the banner and the review sheet. */
  nearby: Record<string, NearbySaves>;
  /** Each trip's "Last time here" cards (#113 · #107). */
  nextTime: Record<string, ForNextTime>;
  errors: Record<string, string>;
}

let state: State = { trips: null, saves: null, bundles: {}, nearby: {}, nextTime: {}, errors: {} };
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
    void persistInProgress();
  } catch (e) {
    set({ ...state, errors: { ...state.errors, [id]: message(e) } });
  }
}

/** Optimistic local edit of a loaded trip (the same pure helpers the web uses). */
export function updateTrip(id: string, fn: (t: Trip) => Trip): void {
  const b = state.bundles[id];
  if (!b) return;
  set({ ...state, bundles: { ...state.bundles, [id]: { ...b, trip: fn(b.trip) } } });
  void persistInProgress();
}

// ── #113 · the trip in progress, on the phone ───────────────────────────────

/** AsyncStorage key for the in-progress bundles. Bump on a shape change. */
const IN_PROGRESS_KEY = "rv.inProgressTrips.v1";

const inProgress = (t: Pick<Trip, "startDate" | "endDate">, today = localIsoDate()) =>
  t.startDate <= today && today <= t.endDate;

/** Write every loaded bundle whose trip covers today. Best effort: a failed
 * write only costs the offline-after-relaunch case. */
async function persistInProgress(): Promise<void> {
  const keep = Object.values(state.bundles).filter((b) => inProgress(b.trip));
  try {
    await AsyncStorage.setItem(IN_PROGRESS_KEY, JSON.stringify(keep));
  } catch {
    // nothing better to do
  }
}

let hydrated: Promise<void> | null = null;

/** Read the persisted in-progress bundles back, once. A bundle already loaded
 * this session wins (it is fresher); an unreadable store is no bundles. */
export function hydrateInProgress(): Promise<void> {
  if (!hydrated) {
    hydrated = AsyncStorage.getItem(IN_PROGRESS_KEY)
      .then((raw) => {
        if (!raw) return;
        const list: unknown = JSON.parse(raw);
        if (!Array.isArray(list)) return;
        const bundles = { ...state.bundles };
        for (const item of list) {
          const parsed = tripBundleSchema.safeParse(item);
          if (parsed.success && !bundles[parsed.data.trip.id]) bundles[parsed.data.trip.id] = parsed.data;
        }
        set({ ...state, bundles });
      })
      .catch(() => undefined);
  }
  return hydrated;
}

/**
 * Today's stop (#113 · "Did it"): the stop the chip files onto, from every
 * bundle the phone holds — loaded this session or persisted from the last.
 * Online, the trips list is read and each in-progress trip's bundle loaded
 * (and so persisted) if it isn't already.
 */
export function useTodaysStop() {
  const bundles = useSyncExternalStore(subscribe, () => state.bundles);
  const trips = useSyncExternalStore(subscribe, () => state.trips);
  useEffect(() => {
    void hydrateInProgress();
    if (trips === null) void loadTrips();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    for (const t of trips ?? []) if (inProgress(t) && !state.bundles[t.id]) void loadBundle(t.id);
  }, [trips]);
  return useMemo(() => todaysStop(Object.values(bundles).map((b) => b.trip), localIsoDate()), [bundles]);
}

/** A Did-it's provisional idea (id = its clientId) onto today's stop, so the
 * stop screen shows it before — or without — signal. */
export function addProvisionalIdea(tripId: string, stopId: string, idea: Idea): void {
  updateTrip(tripId, (t) => ({
    ...t,
    legs: t.legs.map((l) => ({
      ...l,
      stops: l.stops.map((s) => (s.id === stopId ? { ...s, ideas: [...s.ideas, idea] } : s)),
    })),
  }));
}

/** A Did-it idea still waiting for its POST: its id is its `cap_…` client id,
 * which no PATCH can address yet (the stop screen leaves it alone). */
export function isProvisionalIdea(idea: Pick<Idea, "id">): boolean {
  return idea.id.startsWith("cap_");
}

// When a queued Did-it lands, its provisional row becomes the created one.
onQueueSent((item, value) => {
  if (item.kind !== "idea" || !value || !("tripId" in value) || !("title" in value)) return;
  replaceIdea(value.tripId, item.clientId, value as Idea);
});

/** …swapped for the created row once the POST lands (or removed on Undo). */
export function replaceIdea(tripId: string, oldId: string, next: Idea | null): void {
  updateTrip(tripId, (t) => ({
    ...t,
    legs: t.legs.map((l) => ({
      ...l,
      stops: l.stops.map((s) => ({
        ...s,
        ideas: next
          ? s.ideas.map((i) => (i.id === oldId ? next : i))
          : s.ideas.filter((i) => i.id !== oldId),
      })),
    })),
  }));
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

// ── #113 · #107 "Last time here" ────────────────────────────────────────────

/** Refetch a trip's Last-time cards. Quiet on failure, like the banner. */
export async function loadNextTime(tripId: string): Promise<void> {
  try {
    const nt = await api.trips.forNextTime(tripId);
    set({ ...state, nextTime: { ...state.nextTime, [tripId]: nt } });
  } catch {
    // quiet — no card
  }
}

export function useNextTime(tripId: string) {
  const nextTime = useSyncExternalStore(subscribe, () => state.nextTime[tripId] ?? null);
  useEffect(() => {
    void loadNextTime(tripId);
  }, [tripId]);
  const reload = useCallback(() => loadNextTime(tripId), [tripId]);
  return { nextTime, reload };
}

/** A Last-time row's Add — the nearby sheet's copy — and the row reads
 * "On shelf ✓". Throws on a refusal so the row can put Add back. */
export async function addNextTimeIdea(tripId: string, row: NextTimeRow): Promise<void> {
  const created = await api.ideas.create(nextTimeIdeaBody(tripId, row));
  updateTrip(tripId, (t) => appendShelfIdea(t, created));
  const nt = state.nextTime[tripId];
  if (nt) set({ ...state, nextTime: { ...state.nextTime, [tripId]: markRowOnShelf(nt, row.saveId) } });
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
export async function setHopMode(
  tripId: string,
  segmentId: string,
  mode: TravelMode,
  /** #129 · Q11 A — the keep-or-remove answer for a hop with bookings. */
  bookings?: SegmentBookingsChoice,
): Promise<void> {
  updateTrip(tripId, (t) => setSegmentMode(t, segmentId, mode, bookings ?? "keep"));
  try {
    await api.segments.patch(segmentId, bookings ? { mode, bookings } : { mode });
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

/** #129 · Q10 A — Add flight with Round trip: both boundary hops' flights in
 * one save. The reply is the whole trip (the → home hop may be new), swapped
 * into the bundle. Throws on a refusal (the sheet stays open). */
export async function saveBoundaryFlights(tripId: string, body: BoundaryFlightsBody): Promise<void> {
  const trip = await api.trips.boundaryFlights(tripId, body);
  updateTrip(tripId, () => trip);
}

/** #131 · the phone's + Add ▸ Stop — and the stop a stay idea's "Plan it"
 * becomes. Appended to the trip's last leg; the hops reconcile with it. */
export async function addStop(
  tripId: string,
  place: Place,
  dates: { arriveDate: IsoDate | null; departDate: IsoDate | null } = { arriveDate: null, departDate: null },
): Promise<string | null> {
  const trip = state.bundles[tripId]?.trip;
  const legId = trip ? legOrder(trip).at(-1) : undefined;
  if (!legId) return null;
  const stop = await api.stops.create({ legId, place, ...dates });
  updateTrip(tripId, (t) => appendStop(t, stop));
  return stop.id;
}

const planned = (t: Trip, stopId: string, ideaId: string): Trip =>
  updateStop(t, stopId, (s) => ({
    ...s,
    ideas: s.ideas.map((i) => (i.id === ideaId ? { ...i, status: "planned" as const } : i)),
  }));

/** #131 · Plan it on a do/eat maybe: onto the stop you pick, planned. */
export async function planIdeaToStop(tripId: string, ideaId: string, stopId: string): Promise<void> {
  await api.ideas.patch(ideaId, { stopId, status: "planned" });
  updateTrip(tripId, (t) => planned(attachIdeaToStop(t, ideaId, stopId), stopId, ideaId));
}

/** #131 · Plan it on a maybe already pinned to its stop: just planned. */
export async function planPinnedIdea(tripId: string, stopId: string, ideaId: string): Promise<void> {
  await api.ideas.patch(ideaId, { status: "planned" });
  updateTrip(tripId, (t) => planned(t, stopId, ideaId));
}

/** #131 · Plan it on a stay maybe: its nights make it a stop, and it is
 * planned onto it (the web's `planIdeaOnDates`). */
export async function planStayIdea(
  tripId: string,
  ideaId: string,
  span: { start: IsoDate; end: IsoDate },
): Promise<void> {
  const it = state.bundles[tripId]?.trip.ideas.find((i) => i.id === ideaId);
  if (!it) return;
  const place = it.place ?? { name: it.title, lat: null, lng: null, googlePlaceId: null };
  const stopId = await addStop(tripId, place, { arriveDate: span.start, departDate: span.end });
  if (stopId) await planIdeaToStop(tripId, ideaId, stopId);
}
