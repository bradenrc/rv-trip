import { DEFAULT_UNITS, isUnits, type Units } from "@rv-trip/core";

/**
 * The units preference (issue #45 item 5 · issue #38), beside `theme.ts`.
 *
 * Unlike the theme, units is resolved on the SERVER and handed down as a plain
 * prop. All four consumers — the dashboard card, the Route rail, the map's arc
 * labels and the rig form — sit inside a tree whose root is a server component
 * that is already `force-dynamic` and already calls `getOwner()`, so it can
 * call `getPrefsByOwner()` beside it and pass the answer down. That renders the
 * right unit with no flash, and no display component has to become
 * "use client".
 *
 * The `localStorage` copy (the same flat, dash-cased store as `rv-theme` and
 * `rv-map-style`, mirrored to `user_prefs.units` by `lib/pref.ts`) exists only
 * so the Settings control itself can toggle optimistically.
 *
 * Deliberately NOT "use client" and deliberately importing no hook: this module
 * is imported by server components. `SettingsForm` reads the local copy with
 * `useStringPref(UNITS_PREF_KEY, isUnits, DEFAULT_UNITS)` itself.
 */

export const UNITS_PREF_KEY = "rv-units";

export { DEFAULT_UNITS, isUnits, UNITS, type Units } from "@rv-trip/core";

/**
 * The account's units, narrowed. `null` is "never chosen" — the product default
 * wins — and so is a stale value written by a future release.
 */
export function unitsFromPrefs(prefs: { units: string | null } | null | undefined): Units {
  const stored = prefs?.units;
  return stored && isUnits(stored) ? stored : DEFAULT_UNITS;
}
