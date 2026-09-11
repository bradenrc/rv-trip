import { z } from "zod";

/**
 * The rig — one per account, set once, and the input to every RV-safe route.
 *
 * Two rules govern the numbers, and both are safety rules rather than rounding
 * taste (docs/design/9 §3):
 *
 *  1. STORE at millimetre precision, in metric. 11'6" is exactly 3.5052 m, so
 *     the imperial round-trip is lossless. Storing whole centimetres (351) would
 *     read back as 11'6.2" and drift a little further on every edit.
 *  2. ROUND UP at the vendor boundary only. A rig reported one centimetre short
 *     is a rig routed under a bridge it does not clear.
 */

/** What the app stores. The rig CLASS (Class A / Class C / travel trailer /
 * fifth wheel) is a presentation preset, not a stored field — see RIG_PRESETS. */
export const rigType = z.enum(["motorhome", "trailer"]);
export type RigType = z.infer<typeof rigType>;

/** The seven fields. Six of them are the routing input; `name` is yours. */
export const rigProfileInput = z.object({
  name: z.string().min(1),
  type: rigType,
  /** Stored metric at millimetre precision — never whole centimetres. */
  heightMeters: z.number().positive(),
  widthMeters: z.number().positive(),
  lengthMeters: z.number().positive(),
  grossWeightKg: z.number().positive(),
  propaneOnBoard: z.boolean().default(false),
});
export type RigProfileInput = z.infer<typeof rigProfileInput>;

export const rigProfile = rigProfileInput.extend({
  id: z.string(),
  ownerId: z.string(),
});
export type RigProfile = z.infer<typeof rigProfile>;

// ── imperial ⇄ metric ──────────────────────────────────────────────────────
const M_PER_INCH = 0.0254;
const KG_PER_LB = 0.45359237;

/** 0.1 mm — enough that every whole inch survives the round-trip exactly. */
function roundMeters(m: number): number {
  return Math.round(m * 10_000) / 10_000;
}

export function feetInchesToMeters(feet: number, inches: number): number {
  return roundMeters((feet * 12 + inches) * M_PER_INCH);
}

export function metersToFeetInches(meters: number): { feet: number; inches: number } {
  const totalInches = Math.round(meters / M_PER_INCH);
  return { feet: Math.floor(totalInches / 12), inches: totalInches % 12 };
}

export function poundsToKilograms(pounds: number): number {
  return Math.round(pounds * KG_PER_LB * 100) / 100;
}

export function kilogramsToPounds(kg: number): number {
  return Math.round(kg / KG_PER_LB);
}

/** Vendor boundary: whole centimetres, always UP. */
export function metersToVendorCm(meters: number): number {
  // Nudge off float noise (2.54 m must stay 254, not become 255).
  return Math.ceil(Math.round(meters * 100 * 1e6) / 1e6);
}

/** Vendor boundary: whole kilograms, always UP. */
export function kilogramsToVendorKg(kg: number): number {
  return Math.ceil(Math.round(kg * 1e6) / 1e6);
}

// ── rig classes: a head start, never a lock ────────────────────────────────
/**
 * G5: "rig class" has four values, `RigProfile.type` has two. The class is a
 * PRESENTATION preset that fills the six numbers plus a `type`; the stored
 * schema is untouched and every field stays freely editable underneath.
 *
 * These are plausible starting points for the class, not measurements — the
 * form says so, and the user checks them against the plate on the rig. Only the
 * Class C row is load-bearing (it is the issue's rig, and §3's worked math).
 */
export interface RigPresetValues {
  type: RigType;
  heightMeters: number;
  widthMeters: number;
  lengthMeters: number;
  grossWeightKg: number;
  propaneOnBoard: boolean;
}
export interface RigPreset {
  id: string;
  label: string;
  /** The second line on the preset tile. */
  description: string;
  /** null = "Something else": fills nothing, decides no type. */
  values: RigPresetValues | null;
}

function preset(
  id: string,
  label: string,
  description: string,
  type: RigType,
  height: [number, number],
  width: [number, number],
  length: [number, number],
  pounds: number,
): RigPreset {
  return {
    id,
    label,
    description,
    values: {
      type,
      heightMeters: feetInchesToMeters(height[0], height[1]),
      widthMeters: feetInchesToMeters(width[0], width[1]),
      lengthMeters: feetInchesToMeters(length[0], length[1]),
      grossWeightKg: poundsToKilograms(pounds),
      propaneOnBoard: true,
    },
  };
}

export const RIG_PRESETS: RigPreset[] = [
  preset("class-a", "Class A", "12′6″ · 36′ · 26,000 lb", "motorhome", [12, 6], [8, 6], [36, 0], 26_000),
  preset("class-c", "Class C", "11′6″ · 26′ · 14,500 lb", "motorhome", [11, 6], [8, 4], [26, 0], 14_500),
  preset("travel-trailer", "Travel trailer", "10′6″ · 26′ · 7,500 lb", "trailer", [10, 6], [8, 0], [26, 0], 7_500),
  preset("fifth-wheel", "Fifth wheel", "13′0″ · 38′ · 16,000 lb", "trailer", [13, 0], [8, 6], [38, 0], 16_000),
  { id: "other", label: "Something else", description: "start blank", values: null },
];

// ── the cache key's rig half ───────────────────────────────────────────────
/** No rig yet — the same code path as a missing key, and a distinct key half. */
export const NO_RIG_HASH = "no-rig";

/**
 * No rig yet, on the ROUTING half of the key. Deliberately the same string as
 * NO_RIG_HASH: the sentinel is already persisted in every cached key and every
 * client that echoed one, so the rename must not change a single stored key.
 */
export const NO_ROUTING_HASH = "no-rig";

/** Web Crypto (browser + Node 20+), so this file stays dependency-free and
 * behaves identically on both sides of the RSC boundary. */
async function sha256Hex(canonical: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * sha256 of the seven fields — RIG IDENTITY, not the route key. Renaming the
 * rig is a real edit to the rig, so it moves this hash; it is not an input to
 * any route, so it must not move `routingHash`.
 *
 * Async because it uses Web Crypto (present in the browser and in Node 20+),
 * which keeps this dependency-free and identical on both sides of the RSC
 * boundary.
 */
export async function rigHash(
  rig: Pick<
    RigProfileInput,
    | "name"
    | "type"
    | "heightMeters"
    | "widthMeters"
    | "lengthMeters"
    | "grossWeightKg"
    | "propaneOnBoard"
  > | null,
): Promise<string> {
  if (!rig) return NO_RIG_HASH;
  return sha256Hex(
    JSON.stringify([
      rig.name,
      rig.type,
      rig.heightMeters,
      rig.widthMeters,
      rig.lengthMeters,
      rig.grossWeightKg,
      rig.propaneOnBoard,
    ]),
  );
}

/**
 * sha256 of the SIX routing fields — the one thing that keys a route, on both
 * sides of the RSC boundary and in the `routes` table's primary key.
 *
 * `rig.name` is absent on purpose (docs/design/43 §1, Q1 = B): a route between
 * two coordinates under a given rig is the same route whatever the rig is
 * called, so renaming "Sunseeker" must not re-bill every drive on every open
 * trip. Everything that DOES reach the vendor is here, plus `type` — HERE is
 * told a constant `transportMode: "truck"` today (providers/here.ts:181-197),
 * but a trailer is a different routing subject the moment the provider learns
 * the difference, and the alternative is a silent wrong-profile cache hit.
 *
 * Computed ONCE on the server and handed to the client as a string, so no
 * client render path ever awaits it.
 */
export async function routingHash(
  rig: Pick<
    RigProfileInput,
    | "type"
    | "heightMeters"
    | "widthMeters"
    | "lengthMeters"
    | "grossWeightKg"
    | "propaneOnBoard"
  > | null,
): Promise<string> {
  if (!rig) return NO_ROUTING_HASH;
  return sha256Hex(
    JSON.stringify([
      rig.type,
      rig.heightMeters,
      rig.widthMeters,
      rig.lengthMeters,
      rig.grossWeightKg,
      rig.propaneOnBoard,
    ]),
  );
}
