"use client";

import { useEffect } from "react";
import { hydrate } from "@/lib/pref";
import { THEME_PREF_KEY, isTheme } from "@/lib/theme";

/**
 * Adopt the account's saved preferences once, after first paint (issue #38).
 *
 * The ORDER here is the whole design (docs/design/45 §Q6):
 *
 *   1. `layout.tsx`'s removal-only inline script already answered the theme
 *      from localStorage, before anything painted. That stays the first-paint
 *      answer — the theme is never a fetch's conclusion.
 *   2. This effect then GETs the row and hands it to `hydrate`, which writes
 *      each non-null column into localStorage and notifies every
 *      `useSyncExternalStore` subscriber — so the map style, the cost toggle
 *      and units re-render themselves with no prop drilling.
 *   3. The theme is the one preference painted as a CLASS on `<html>` rather
 *      than read through a hook, so it is the one thing hydration has to
 *      re-assert by hand.
 *
 * Accepted cost, stated in the design: on a device that has never stored a
 * theme, first paint is the default and the account's answer lands just after.
 * That is the price of no-FOUC, and it is one frame on one device.
 *
 * Renders nothing. Mounted once, in the layout.
 */
export function PrefSync() {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/prefs");
        if (!res.ok || cancelled) return;
        hydrate(await res.json());
        if (cancelled) return;
        const stored = localStorage.getItem(THEME_PREF_KEY);
        if (stored && isTheme(stored)) {
          document.documentElement.classList.toggle("dark", stored === "dark");
        }
      } catch {
        // Offline, signed out mid-flight, or storage blocked: the local copy
        // stands. A preference that fails to sync is never an error the user
        // has to see.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
