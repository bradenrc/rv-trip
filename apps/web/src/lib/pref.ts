"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  PREF_REMOTE,
  isRemotePrefKey,
  toLocalEntries,
  toRemotePatch,
  type UserPrefs,
} from "@rv-trip/core";

/**
 * Preferences persisted in localStorage. localStorage is an external store, so
 * it's read through useSyncExternalStore rather than a read-in-effect +
 * setState — no cascading render, and the server snapshot is the default.
 *
 * Keys are flat and dash-cased: `rv-track-costs`, `rv-map-style`.
 *
 * Four of those keys also have a column behind them (`user_prefs`, issue #38),
 * so the choice follows the account to another device. That mirroring lives
 * ENTIRELY in this file: every consumer already goes through `useBooleanPref` /
 * `useStringPref`, so not one call site changes. Local write first, then
 * `notify()`, then a fire-and-forget PUT — a failed sync costs the sync, never
 * the interaction.
 */
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function notify() {
  for (const l of listeners) l();
}

/**
 * localStorage key → `user_prefs` column. Defined in `@rv-trip/core` (with the
 * value coercion that goes with it, which is not the identity — see
 * `toRemotePatch`) so the mapping is unit-tested as executed code rather than
 * asserted as source text; re-exported here because this module is where the
 * seam reads from.
 */
export const REMOTE = PREF_REMOTE;

/**
 * Mirror one local write to the account row. Fire-and-forget on purpose: the
 * preference has already taken effect locally, and a dead network must not turn
 * a toggle into an error. Unmapped keys (anything local-only) are a no-op.
 */
function pushRemote(key: string, stored: string): void {
  if (!isRemotePrefKey(key)) return;
  try {
    void fetch("/api/prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(toRemotePatch(key, stored)),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // No fetch (a very old embed), or a blocked origin. The local write stands.
  }
}

/**
 * Adopt the account's saved preferences — called once, after mount, by
 * `<PrefSync/>` with whatever `/api/prefs` answered.
 *
 * Null columns are skipped, not written: null means "never chosen", so an
 * account that has only ever set a theme leaves this device's other three
 * choices exactly as it found them. One `notify()` at the end, and only if
 * something actually changed, so an unchanged row costs zero re-renders.
 *
 * This is deliberately NOT the theme's first-paint answer: `layout.tsx`'s
 * removal-only inline script already read localStorage before anything painted,
 * and the theme is never a fetch's conclusion.
 */
export function hydrate(row: UserPrefs | null | undefined): void {
  let changed = false;
  for (const [key, value] of toLocalEntries(row)) {
    try {
      if (localStorage.getItem(key) === value) continue;
      localStorage.setItem(key, value);
      changed = true;
    } catch {
      // Private mode or a blocked origin: the row simply does not stick here.
      return;
    }
  }
  if (changed) notify();
}

export function useBooleanPref(key: string): [boolean, (on: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(key) === "1",
    () => false, // SSR + first paint: the default is off
  );
  const set = useCallback(
    (on: boolean) => {
      const stored = on ? "1" : "0";
      localStorage.setItem(key, stored);
      notify();
      pushRemote(key, stored);
    },
    [key],
  );
  return [value, set];
}

/** "" is a real client answer — "nothing stored" — so it can't double as the
 * server's "not resolved yet", which is null. */
const UNSET = "";

function readString(key: string): string {
  try {
    return localStorage.getItem(key) ?? UNSET;
  } catch {
    // Private mode, a blocked origin, a hostile embed: none of them is a reason
    // to blank the caller.
    return UNSET;
  }
}

/**
 * A preference drawn from a small vocabulary of strings.
 *
 * Unlike `useBooleanPref`, this one distinguishes *unresolved* from *default*:
 * the server snapshot is `null`, so a caller whose first paint is expensive to
 * get wrong — the map, which would otherwise fetch a whole basemap style it is
 * about to throw away — can hold a placeholder for the one render before the
 * real value arrives, instead of flashing the default. Anything unreadable,
 * missing, or outside the vocabulary (a stale value written by a future
 * release) resolves to `fallback`.
 */
export function useStringPref<T extends string>(
  key: string,
  isValid: (v: string) => v is T,
  fallback: T,
): [T | null, (v: T) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => readString(key),
    () => null, // SSR + hydration: not resolved yet
  );
  const value = raw === null ? null : isValid(raw) ? raw : fallback;
  const set = useCallback(
    (v: T) => {
      try {
        localStorage.setItem(key, v);
      } catch {
        // The preference doesn't stick this session; the map still switches.
      }
      notify();
      pushRemote(key, v);
    },
    [key],
  );
  return [value, set];
}
