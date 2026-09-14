import { z } from "zod";

/**
 * Preferences that follow the account (docs/design/45 §"Q6 · where preferences
 * live", issue #38).
 *
 * Four preferences — theme, units, default map style, cost tracking — live in
 * ONE `user_prefs` row per account, with `localStorage` in front of it: the
 * local copy is what first paint reads (layout.tsx's removal-only no-FOUC
 * script), and the row is what makes the choice follow you to another device.
 *
 * This module is the seam between the two vocabularies, and it lives in core —
 * not in `apps/web/src/lib/pref.ts` — for one reason: it is the only part of
 * the feature that is pure logic, so here it is *executed* by the test runner
 * instead of grepped. `pref.ts` keeps the React hooks and the fetch; it imports
 * the translation from here.
 *
 * Two translations, and neither is the identity:
 *
 *   LOCAL → REMOTE  everything in `localStorage` is a string. `useBooleanPref`
 *                   stores "1"/"0", but `user_prefs.track_costs` is a real
 *                   `boolean` column, so the string has to be coerced or the
 *                   PUT is rejected by its own schema.
 *   REMOTE → LOCAL  the inverse, plus the null rule: every preference column is
 *                   NULLABLE on purpose — null means "never chosen", the product
 *                   default still wins, and no backfill is needed. A null must
 *                   therefore write NOTHING, never the string "null".
 *
 * Deliberately NOT validated here: the value vocabularies. `theme`, `units` and
 * `map_style` are `text` columns, not enums, and every reader already narrows an
 * untrusted string to its own vocabulary with a fallback (`isTheme`,
 * `isStyleMode`, `useStringPref`'s `isValid`) precisely so a stale value written
 * by a future release degrades instead of throwing. Re-stating those lists here
 * would fork them from the modules that own them.
 */

/** localStorage key → `user_prefs` column. The one map; nothing else pairs them. */
export const PREF_REMOTE = {
  "rv-theme": "theme",
  "rv-units": "units",
  "rv-map-style": "mapStyle",
  "rv-track-costs": "trackCosts",
} as const;

/** A localStorage key that has a column behind it. Other `rv-*` keys are local-only. */
export type PrefLocalKey = keyof typeof PREF_REMOTE;

/** The column a mapped key writes. */
export type PrefColumn = (typeof PREF_REMOTE)[PrefLocalKey];

export const PREF_LOCAL_KEYS = Object.keys(PREF_REMOTE) as readonly PrefLocalKey[];

/** The one preference stored as "1"/"0" locally and as a boolean remotely. */
const BOOLEAN_PREF_KEY = "rv-track-costs" satisfies PrefLocalKey;

/** Is this key mirrored to the account row at all? */
export function isRemotePrefKey(key: string): key is PrefLocalKey {
  return Object.prototype.hasOwnProperty.call(PREF_REMOTE, key);
}

/** The PUT body — a PARTIAL. Absent means "not touching this one"; an explicit
 * null means "put it back to never-chosen". `.strict()` so a body that names a
 * column this build does not have (or tries to name `ownerId`) is a 400 rather
 * than a silent no-op. */
export const userPrefsPatch = z
  .object({
    theme: z.string().max(32).nullable().optional(),
    units: z.string().max(32).nullable().optional(),
    mapStyle: z.string().max(32).nullable().optional(),
    trackCosts: z.boolean().nullable().optional(),
  })
  .strict();
export type UserPrefsPatch = z.infer<typeof userPrefsPatch>;

/** The row as `/api/prefs` GET serves it. Every preference may be null. */
export interface UserPrefs {
  ownerId: string;
  theme: string | null;
  units: string | null;
  mapStyle: string | null;
  trackCosts: boolean | null;
  /** ISO-8601 instant. A row timestamp, unlike a trip date, is a real moment. */
  updatedAt: string;
}

/**
 * One local write → the one-field patch that mirrors it. One field, never four:
 * a PUT from the theme toggle must not carry — and so must not be able to
 * clobber — the other three.
 */
export function toRemotePatch(key: PrefLocalKey, stored: string): UserPrefsPatch {
  if (key === BOOLEAN_PREF_KEY) {
    // `useBooleanPref` reads with `getItem(key) === "1"`; write-through has to
    // agree with the reader, not with JS truthiness.
    return { trackCosts: stored === "1" };
  }
  return { [PREF_REMOTE[key]]: stored } as UserPrefsPatch;
}

/**
 * A row → the `localStorage` writes it implies, in key order. Null columns are
 * skipped (see the null rule above), so an account that has only ever set a
 * theme leaves the other three local values exactly as the device had them.
 */
export function toLocalEntries(row: UserPrefs | null | undefined): Array<[PrefLocalKey, string]> {
  if (!row) return [];
  const out: Array<[PrefLocalKey, string]> = [];
  for (const key of PREF_LOCAL_KEYS) {
    const value = row[PREF_REMOTE[key]];
    if (value === null || value === undefined) continue;
    out.push([key, typeof value === "boolean" ? (value ? "1" : "0") : String(value)]);
  }
  return out;
}
