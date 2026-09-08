"use client";

import { useStringPref } from "@/lib/pref";

/**
 * The app theme (issue #19).
 *
 * Dark is the default and it is stated in the HTML — `layout.tsx` renders
 * `class="dark"` on `<html>` and a removal-only inline script strips it before
 * first paint for anyone who chose light. So the DOM class is the source of
 * truth; this module only keeps a durable copy of it, in the same localStorage
 * store the map style and the cost toggle already use (flat, dash-cased keys:
 * `rv-map-style`, `rv-track-costs`, and now `rv-theme`).
 *
 * There is deliberately no provider and no context: React never owns the class.
 */

export const THEME_PREF_KEY = "rv-theme";

export const THEMES = ["dark", "light"] as const;

export type Theme = (typeof THEMES)[number];

/** The product default, and what the server renders. */
export const DEFAULT_THEME: Theme = "dark";

/** Narrow an untrusted string — a persisted preference, a stale value from a
 * future release — to a theme this build actually paints. */
export function isTheme(value: string): value is Theme {
  return (THEMES as readonly string[]).includes(value);
}

/**
 * Read + write the theme. Returning `DEFAULT_THEME` for the unresolved
 * (server / pre-hydration) snapshot is safe precisely because the server
 * rendered exactly that.
 */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [stored, store] = useStringPref(THEME_PREF_KEY, isTheme, DEFAULT_THEME);
  const set = (t: Theme) => {
    document.documentElement.classList.toggle("dark", t === "dark");
    store(t);
  };
  return [stored ?? DEFAULT_THEME, set];
}
