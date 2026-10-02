import { useEffect, useSyncExternalStore } from "react";
import { Alert, AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import type {
  CaptureDraft,
  DidItBody,
  Idea,
  JournalPatchBody,
  PatchEntity,
  QueuedItem,
  SavedPlace,
  ToastCopy,
} from "@rv-trip/core";
import {
  CAPTURE_QUEUE_KEY,
  CAPTURE_QUEUE_KEY_V1,
  JOURNAL_QUEUED_TOAST,
  enqueue,
  flushCaptureQueue,
  heardFromRecents,
  journalToast,
  migrateCaptureQueue,
  newClientId,
  queuedToast,
  savedToast,
  syncedToast,
} from "@rv-trip/core";
import { ApiError } from "@rv-trip/core/api-client";
import { api } from "./api";

/**
 * The capture runtime (#111 · docs/design/111 #100): the persisted queue, the
 * connectivity signal, the flush triggers and the toast.
 *
 * Every capture is written to the queue FIRST — to AsyncStorage under
 * `rv.captureQueue.v2` — and then sent. The ordering, retry and drop rules are
 * core's (`packages/core/src/capture/queue.ts`, where they are unit tested);
 * this file only persists, listens and renders their outcome.
 *
 * #113 (W3 Journal, Q5 A): the same queue carries a check-off PATCH and a
 * "Did it" idea, so a check-off on a beach with no bars survives. The v1 key
 * is read once on load (its items become saves) and cleared. A journal write
 * says "In your journal" (green, with Undo) when it lands and "Saved on this
 * phone" (amber) when it waits — replacing the old "Didn't save" alert.
 *
 * The flush runs on the change to online, on app foreground, and right after
 * each enqueue. One flush at a time: a trigger that lands mid-flush is folded
 * into one more pass when the current one ends.
 */

export type ToastTone = "saved" | "queued" | "synced" | "journal" | "journal-queued";

export interface CaptureToast extends ToastCopy {
  tone: ToastTone;
  /** "saved" only: the row Undo deletes. */
  undoId?: string;
  /** "journal" only: puts the thing back the way it was. */
  onUndo?: () => void;
  key: number;
}

interface State {
  queue: QueuedItem[];
  online: boolean;
  toast: CaptureToast | null;
  /** Heard-from recents — the library's distinct sources, newest first. */
  recents: string[];
}

let state: State = { queue: [], online: true, toast: null, recents: [] };
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Reachable, as NetInfo reports it. `isInternetReachable` is null while it is
 * still probing — that counts as online, or a fresh launch would read offline. */
function isOnline(s: NetInfoState): boolean {
  return s.isConnected !== false && s.isInternetReachable !== false;
}

// ── persistence ──────────────────────────────────────────────────────────────

async function persist(queue: QueuedItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CAPTURE_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // The in-memory queue still flushes this session; only a relaunch before
    // signal could lose it, and a failed write has no better answer.
  }
}

let loaded: Promise<void> | null = null;

function load(): Promise<void> {
  if (!loaded) {
    loaded = Promise.all([
      AsyncStorage.getItem(CAPTURE_QUEUE_KEY),
      AsyncStorage.getItem(CAPTURE_QUEUE_KEY_V1),
    ])
      .then(async ([v2, v1]) => {
        // v1 → v2: every W1 item becomes a `kind: "save"`, written under v2
        // and the v1 key cleared, so it is migrated exactly once.
        let queue = migrateCaptureQueue(v2, v1);
        // Anything queued before the read finished is kept alongside.
        for (const item of state.queue) queue = enqueue(queue, item);
        set({ queue });
        if (v1 !== null) {
          await persist(queue);
          await AsyncStorage.removeItem(CAPTURE_QUEUE_KEY_V1).catch(() => undefined);
        }
      })
      .catch(() => undefined);
  }
  return loaded;
}

// ── the toast ────────────────────────────────────────────────────────────────

let toastKey = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
const TOAST_MS = 5000;

function showToast(copy: ToastCopy, tone: ToastTone, extra: { undoId?: string; onUndo?: () => void } = {}) {
  if (toastTimer) clearTimeout(toastTimer);
  const key = ++toastKey;
  set({ toast: { ...copy, tone, ...extra, key } });
  toastTimer = setTimeout(() => {
    if (state.toast?.key === key) set({ toast: null });
  }, TOAST_MS);
}

export function dismissToast() {
  if (toastTimer) clearTimeout(toastTimer);
  set({ toast: null });
}

/** Undo on the saved toast: DELETE /api/places/:id. */
export async function undoSave(id: string): Promise<void> {
  dismissToast();
  try {
    await api.places.remove(id);
  } catch {
    // Nothing to roll back on the phone; the row is still in the library.
  }
}

// ── the flush ───────────────────────────────────────────────────────────────

/** What a journal write's toast needs: the trip it lands in, and how to put
 * the thing back (handed the server's answer — a Did-it's created idea). */
export interface JournalAnnounce {
  tripTitle: string;
  undo: (created?: Idea) => void;
}

type Announce =
  | { kind: "capture"; clientId: string }
  | { kind: "journal"; clientId: string; journal: JournalAnnounce }
  | { kind: "sync" };

type Sent = SavedPlace | Idea | undefined;

let flushing = false;
let flushAgain = false;

/** One queued item → its request. An HTTP answer is a status the queue rules
 * key off; anything else (no socket, a timeout) is thrown on as a network
 * failure. */
async function send(item: QueuedItem): Promise<{ status: number; value?: Sent }> {
  try {
    if (item.kind === "save") return { status: 201, value: await api.places.create(item.body) };
    if (item.kind === "idea") return { status: 201, value: await api.ideas.create(item.body) };
    if (item.entity === "idea") await api.ideas.patch(item.id, item.body);
    else if (item.entity === "destination") await api.destinations.patch(item.id, item.body);
    else await api.reservations.patch(item.id, item.body);
    return { status: 204 };
  } catch (e) {
    if (e instanceof ApiError) return { status: e.status };
    throw e;
  }
}

/** Told about every item that reaches the server — the store swaps a Did-it's
 * provisional idea for the created one. */
type SentListener = (item: QueuedItem, value: Sent) => void;
const sentListeners = new Set<SentListener>();
export function onQueueSent(l: SentListener): () => void {
  sentListeners.add(l);
  return () => {
    sentListeners.delete(l);
  };
}

/**
 * Drain the queue. `announce` says what the toast should report:
 * - "capture": this flush follows a capture the user is waiting on — say
 *   "Saved {name}" when it went, "Saved on this phone" when it waits;
 * - "journal": a check-off or a Did it — "In your journal" with Undo, or the
 *   amber "Saved on this phone" when it waits;
 * - "sync": a background trigger — say "Synced N saves" if any save went.
 */
async function flush(announce: Announce): Promise<void> {
  if (flushing) {
    flushAgain = true;
    return;
  }
  flushing = true;
  try {
    await load();
    const out = await flushCaptureQueue<Sent>(state.queue, send);
    set({ queue: out.queue });
    await persist(out.queue);
    for (const s of out.sent) for (const l of sentListeners) l(s.item, s.value);

    const savedValues = out.sent
      .filter((s) => s.item.kind === "save")
      .map((s) => s.value as SavedPlace | undefined)
      .filter((v): v is SavedPlace => !!v);
    const waiting = (clientId: string) => out.queue.some((q) => q.clientId === clientId);
    if (announce.kind === "capture") {
      const mine = out.sent.find((s) => s.item.clientId === announce.clientId)?.value as SavedPlace | undefined;
      if (mine) showToast(savedToast(mine), "saved", { undoId: mine.id });
      else if (waiting(announce.clientId)) showToast(queuedToast(out.queue.length), "queued");
    } else if (announce.kind === "journal") {
      const mine = out.sent.find((s) => s.item.clientId === announce.clientId);
      const { tripTitle, undo } = announce.journal;
      if (mine) {
        showToast(journalToast(tripTitle), "journal", {
          onUndo: () => {
            dismissToast();
            undo(mine.item.kind === "idea" ? (mine.value as Idea | undefined) : undefined);
          },
        });
      } else if (waiting(announce.clientId)) {
        showToast(JOURNAL_QUEUED_TOAST, "journal-queued");
      }
    } else if (savedValues.length > 0) {
      showToast(syncedToast(savedValues), "synced");
    }
    // A journal write the server refused (4xx) is gone for good — say so, the
    // way the destination screen always has.
    if (out.dropped.some((d) => d.kind !== "save")) {
      Alert.alert("Didn’t save", "A check-off was refused by the server and wasn’t logged.");
    }
  } finally {
    flushing = false;
  }
  if (flushAgain) {
    flushAgain = false;
    await flush({ kind: "sync" });
  }
}

/**
 * Queue a capture and try to send it. `capturedAt` is NOW, whenever it goes —
 * the server writes it to created_at, so a save flushed hours later still sorts
 * where it was captured.
 */
export async function capture(draft: CaptureDraft): Promise<void> {
  const clientId = newClientId();
  const item: QueuedItem = {
    kind: "save",
    clientId,
    queuedAt: new Date().toISOString(),
    body: { ...draft, clientId, capturedAt: new Date().toISOString() },
    attempts: 0,
  };
  await load();
  const queue = enqueue(state.queue, item);
  set({ queue });
  await persist(queue);
  if (draft.source) {
    set({ recents: [draft.source, ...state.recents.filter((r) => r !== draft.source)] });
  }
  if (!state.online) {
    showToast(queuedToast(queue.length), "queued");
    return;
  }
  await flush({ kind: "capture", clientId });
}

/** Queue one journal item and send it; `journal` null is a quiet write (a
 * rating, a note) — it still says "Saved on this phone" when it waits. */
async function queueJournal(item: QueuedItem, journal: JournalAnnounce | null): Promise<void> {
  await load();
  const queue = enqueue(state.queue, item);
  set({ queue });
  await persist(queue);
  if (!state.online) {
    showToast(JOURNAL_QUEUED_TOAST, "journal-queued");
    return;
  }
  await flush(journal ? { kind: "journal", clientId: item.clientId, journal } : { kind: "sync" });
}

/**
 * A check-off (#113 · Q3 B · Q5 A): `PATCH /api/{ideas,destinations,reservations}/:id`
 * through the queue. The caller has already updated the local store — the
 * check lands at once, signal or not.
 */
export function queuePatch(
  entity: PatchEntity,
  id: string,
  body: JournalPatchBody,
  journal: JournalAnnounce | null = null,
): Promise<void> {
  return queueJournal(
    { kind: "patch", clientId: newClientId(), queuedAt: new Date().toISOString(), attempts: 0, entity, id, body },
    journal,
  );
}

/** "Did it" (#113 · Q1 B): a born-done idea, replayable on its clientId. */
export function queueDidIt(body: DidItBody, journal: JournalAnnounce): Promise<void> {
  return queueJournal(
    { kind: "idea", clientId: body.clientId, queuedAt: new Date().toISOString(), attempts: 0, body },
    journal,
  );
}

/** Refresh the Heard-from recents from the library. Online only; best effort. */
export async function loadRecents(): Promise<void> {
  if (!state.online) return;
  try {
    const saves = await api.places.list();
    set({ recents: heardFromRecents(saves) });
  } catch {
    // Keep whatever we had — the chips are a convenience.
  }
}

// ── the runtime ──────────────────────────────────────────────────────────────

/**
 * Mount once, inside the auth gate (the flush needs the session's token).
 * Loads the queue, follows connectivity, and flushes on the way back online
 * and on every return to the foreground.
 */
export function useCaptureRuntime(): void {
  useEffect(() => {
    void load().then(() => {
      if (state.online && state.queue.length > 0) void flush({ kind: "sync" });
    });
    const offNet = NetInfo.addEventListener((s) => {
      const online = isOnline(s);
      const cameBack = online && !state.online;
      if (online !== state.online) set({ online });
      if (cameBack && state.queue.length > 0) void flush({ kind: "sync" });
    });
    const offApp = AppState.addEventListener("change", (s) => {
      if (s === "active" && state.online && state.queue.length > 0) void flush({ kind: "sync" });
    });
    return () => {
      offNet();
      offApp.remove();
    };
  }, []);
}

export function useCaptureState(): State {
  return useSyncExternalStore(subscribe, () => state);
}
