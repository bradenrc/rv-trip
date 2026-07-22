"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A boolean preference persisted in localStorage. localStorage is an external
 * store, so it's read through useSyncExternalStore rather than a read-in-effect
 * + setState — no cascading render, and the server snapshot is the default.
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

export function useBooleanPref(key: string): [boolean, (on: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(key) === "1",
    () => false, // SSR + first paint: the default is off
  );
  const set = useCallback(
    (on: boolean) => {
      localStorage.setItem(key, on ? "1" : "0");
      for (const l of listeners) l();
    },
    [key],
  );
  return [value, set];
}
