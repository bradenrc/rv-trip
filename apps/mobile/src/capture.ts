import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import type { CaptureDraft, QueuedCapture, SavedPlace, ToastCopy } from "@rv-trip/core";
import {
  CAPTURE_QUEUE_KEY,
  enqueue,
  flushCaptureQueue,
  heardFromRecents,
  newClientId,
  parseCaptureQueue,
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
 * `rv.captureQueue.v1` — and then sent. The ordering, retry and drop rules are
 * core's (`packages/core/src/capture/queue.ts`, where they are unit tested);
 * this file only persists, listens and renders their outcome.
 *
 * The flush runs on the change to online, on app foreground, and right after
 * each enqueue. One flush at a time: a trigger that lands mid-flush is folded
 * into one more pass when the current one ends.
 */

export type ToastTone = "saved" | "queued" | "synced";

export interface CaptureToast extends ToastCopy {
  tone: ToastTone;
  /** "saved" only: the row Undo deletes. */
  undoId?: string;
  key: number;
}

interface State {
  queue: QueuedCapture[];
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

async function persist(queue: QueuedCapture[]): Promise<void> {
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
    loaded = AsyncStorage.getItem(CAPTURE_QUEUE_KEY)
      .then((raw) => {
        // Anything captured before the read finished is kept alongside.
        let queue = parseCaptureQueue(raw);
        for (const item of state.queue) queue = enqueue(queue, item);
        set({ queue });
      })
      .catch(() => undefined);
  }
  return loaded;
}

// ── the toast ────────────────────────────────────────────────────────────────

let toastKey = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
const TOAST_MS = 5000;

function showToast(copy: ToastCopy, tone: ToastTone, undoId?: string) {
  if (toastTimer) clearTimeout(toastTimer);
  const key = ++toastKey;
  set({ toast: { ...copy, tone, undoId, key } });
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

let flushing = false;
let again = false;

/**
 * Drain the queue. `announce` says what the toast should report:
 * - "capture": this flush follows a capture the user is waiting on — say
 *   "Saved {name}" when it went, "Saved on this phone" when it waits;
 * - "sync": a background trigger — say "Synced N saves" if anything went.
 */
async function flush(announce: { kind: "capture"; clientId: string } | { kind: "sync" }): Promise<void> {
  if (flushing) {
    again = true;
    return;
  }
  flushing = true;
  try {
    await load();
    const out = await flushCaptureQueue<SavedPlace>(state.queue, async (item) => {
      try {
        const saved = await api.places.create(item.body);
        return { status: 201, value: saved };
      } catch (e) {
        // An HTTP answer is a status the queue rules key off; anything else
        // (no socket, a timeout) is thrown on as a network failure.
        if (e instanceof ApiError) return { status: e.status };
        throw e;
      }
    });
    set({ queue: out.queue });
    await persist(out.queue);

    const saved = out.sent.map((s) => s.value).filter((v): v is SavedPlace => !!v);
    if (announce.kind === "capture") {
      const mine = out.sent.find((s) => s.item.clientId === announce.clientId)?.value;
      if (mine) showToast(savedToast(mine), "saved", mine.id);
      else if (out.queue.some((q) => q.clientId === announce.clientId))
        showToast(queuedToast(out.queue.length), "queued");
    } else if (saved.length > 0) {
      showToast(syncedToast(saved), "synced");
    }
  } finally {
    flushing = false;
  }
  if (again) {
    again = false;
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
  const item: QueuedCapture = {
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
