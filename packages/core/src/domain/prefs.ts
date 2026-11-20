import { z } from "zod";
import { place, type Place } from "./types";
import type { StyleMode } from "../theme/map-palette";

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
  // #198 · which map draws every map (docs/design/202). Text column, null =
  // never chosen → DEFAULT_MAP_ENGINE.
  "rv-map-engine": "mapEngine",
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
    /** #198 — the map engine. A free string like `mapStyle`: readers narrow it
     * with `isMapEngine` / `resolveMapEngine` and fall back to Mapbox. */
    mapEngine: z.string().max(32).nullable().optional(),
    /**
     * #126 · Q5 A — the HOUSEHOLD home base: where every trip starts and ends
     * unless the trip overrides it. One object on the wire (name + point + place
     * id), four nullable columns underneath (`user_prefs.home_base*`); `null`
     * clears it. Not a localStorage pref — nothing in PREF_REMOTE maps to it.
     */
    homeBasePlace: place.nullable().optional(),
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
  /** #198 · the map engine, or null (never chosen). Optional so a row served by
   * an older build (or a fixture) still types. */
  mapEngine?: string | null;
  /** #126 · the household home base, or null. Optional so a row served by an
   * older build (or a fixture) still types. */
  homeBasePlace?: Place | null;
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

/**
 * #126 · Q5 A — the home base a trip actually starts from: its OWN override
 * (`trips.home_base*`) when it has one, else the household default
 * (`user_prefs.home_base*`), else nothing. `fromHousehold` says which, so Trip
 * settings can read "household default". The server's `getTripById` and the
 * segment reconcile both read through this one rule, so the hop set and the
 * masthead can never disagree.
 */
export interface ResolvedHomeBase {
  homeBase: string | null;
  homeBasePlace: Place | null;
  fromHousehold: boolean;
}

export function resolveHomeBase(
  trip: { homeBase: string | null; homeBasePlace: Place | null },
  household: Place | null | undefined,
): ResolvedHomeBase {
  if (trip.homeBase !== null) {
    return { homeBase: trip.homeBase, homeBasePlace: trip.homeBasePlace, fromHousehold: false };
  }
  if (household && household.name.trim() !== "") {
    return { homeBase: household.name, homeBasePlace: household, fromHousehold: true };
  }
  return { homeBase: null, homeBasePlace: null, fromHousehold: false };
}

/**
 * #142 · Q5 A — the Rig screen's "🏠 Home base" row value: the household home
 * base's name and a chevron, or "set one ›" when there is none (or no prefs
 * row at all).
 */
export function homeBaseRowValue(prefs: Pick<UserPrefs, "homeBasePlace"> | null | undefined): string {
  const name = prefs?.homeBasePlace?.name?.trim();
  return name ? `${name} ›` : "set one ›";
}

/**
 * #142 — a place-search pick as the `PUT /api/prefs` partial that sets the
 * HOUSEHOLD home base. Only the four `Place` fields go on the wire; a pick's
 * extras (address, Google's primaryType) are dropped.
 */
export function householdHomeBasePatch(
  picked: Pick<Place, "name" | "lat" | "lng" | "googlePlaceId">,
): { homeBasePlace: Place } {
  return {
    homeBasePlace: { name: picked.name, lat: picked.lat, lng: picked.lng, googlePlaceId: picked.googlePlaceId },
  };
}

// ── #198 · the map engine (docs/design/202 §3 "The seam") ────────────────────

/** Which map draws the basemap. Our own marks (discs, arcs, saves) are drawn in
 * `MAP_PALETTE` colours on either. */
export type MapEngine = "mapbox" | "google";

/** Never chosen (a null `user_prefs.map_engine`) draws Mapbox. */
export const DEFAULT_MAP_ENGINE: MapEngine = "mapbox";

/** The two engines in pill order, with the label both clients show. */
export const MAP_ENGINES: ReadonlyArray<{ value: MapEngine; label: string }> = [
  { value: "mapbox", label: "Mapbox" },
  { value: "google", label: "Google" },
];

export function isMapEngine(v: unknown): v is MapEngine {
  return v === "mapbox" || v === "google";
}

/** Why this client can't draw Google right now.
 *   no-key     — web build missing NEXT_PUBLIC_GOOGLE_MAPS_KEY or NEXT_PUBLIC_GOOGLE_MAP_ID
 *   no-module  — phone binary without the native Google map module
 *   not-built  — the Google renderer has not landed on this client yet */
export type GoogleFallbackReason = "no-key" | "no-module" | "not-built";

export type GoogleAvailability = { ok: true } | { ok: false; reason: GoogleFallbackReason };

export interface ResolvedMapEngine {
  /** What actually draws. */
  engine: MapEngine;
  /** Set only when the account chose Google and this client can't draw it. */
  fallback: GoogleFallbackReason | null;
}

/**
 * The account's choice → what gets drawn (docs/design/202, the resolution
 * table). The choice is NEVER rewritten here: a client that can't draw Google
 * draws Mapbox and says why, and the stored "google" is kept (q2 A), so a phone
 * without the native module can't undo a choice made on the web.
 */
export function resolveMapEngine(
  choice: string | null | undefined,
  google: GoogleAvailability,
): ResolvedMapEngine {
  if (choice !== "google") return { engine: DEFAULT_MAP_ENGINE, fallback: null };
  if (google.ok) return { engine: "google", fallback: null };
  return { engine: "mapbox", fallback: google.reason };
}

/** The amber line under the engine pill, per fallback reason — the wireframe's
 * copy verbatim. `title` is the bold first line, `body` the second. */
export const MAP_ENGINE_FALLBACK_COPY: Record<GoogleFallbackReason, { title: string; body: string }> = {
  "no-key": { title: "Google isn’t set up here", body: "Showing Mapbox. Your choice is kept." },
  "no-module": {
    title: "This version of the app has no Google map",
    body: "Showing Mapbox until you update.",
  },
  "not-built": { title: "Google map is coming", body: "Showing Mapbox for now. Your choice is kept." },
};

/** The same copy as one line, for the Settings / You-tab rows (the wireframe's
 * `⚠ This version of the app has no Google map. Showing Mapbox until you update.`). */
export function mapEngineFallbackLine(reason: GoogleFallbackReason): string {
  const { title, body } = MAP_ENGINE_FALLBACK_COPY[reason];
  return `⚠ ${title}. ${body}`;
}

// ── #199 · the web Google engine (docs/design/202 §3 "The seam", the mode table) ──

/**
 * Whether a WEB build can draw Google: only with BOTH the browser Maps JS key
 * (`NEXT_PUBLIC_GOOGLE_MAPS_KEY`) and a Map ID (`NEXT_PUBLIC_GOOGLE_MAP_ID`).
 * The Map ID is required, not optional (q4 A): the discs are Advanced Markers,
 * and night is the Map ID's DARK colour scheme. Either one missing, empty or
 * blank is the "no-key" case. The caller passes the two `process.env` reads
 * literally, so Next inlines them into the client bundle.
 */
export function webGoogleAvailability(
  key: string | null | undefined,
  mapId: string | null | undefined,
): GoogleAvailability {
  return key?.trim() && mapId?.trim() ? { ok: true } : { ok: false, reason: "no-key" };
}

/** A Google Maps JS basemap, as `MapOptions` takes it. String literals, not the
 * `google.maps` enums, so core stays vendor-free. */
export interface GoogleWebBasemap {
  mapTypeId: "roadmap" | "hybrid";
  colorScheme: "LIGHT" | "DARK";
}

/**
 * Style mode → Google basemap on the web (the wireframe's mode table): day is
 * roadmap, night is roadmap on the Map ID's DARK colour scheme, sat is hybrid.
 * Our own marks keep `MAP_PALETTE[mode]` on either engine.
 */
export const GOOGLE_WEB_BASEMAP: Record<StyleMode, GoogleWebBasemap> = {
  day: { mapTypeId: "roadmap", colorScheme: "LIGHT" },
  night: { mapTypeId: "roadmap", colorScheme: "DARK" },
  sat: { mapTypeId: "hybrid", colorScheme: "LIGHT" },
};
