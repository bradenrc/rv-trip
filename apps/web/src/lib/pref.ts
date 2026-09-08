"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Preferences persisted in localStorage. localStorage is an external store, so
 * it's read through useSyncExternalStore rather than a read-in-effect +
 * setState — no cascading render, and the server snapshot is the default.
 *
 * Keys are flat and dash-cased: `rv-track-costs`, `rv-map-style`.
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

export function useBooleanPref(key: string): [boolean, (on: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(key) === "1",
    () => false, // SSR + first paint: the default is off
  );
  const set = useCallback(
    (on: boolean) => {
      localStorage.setItem(key, on ? "1" : "0");
      notify();
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
    },
    [key],
  );
  return [value, set];
}
