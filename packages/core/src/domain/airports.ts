import type { IsoDate } from "./types";

/**
 * Local time, with the zone taken from the airport code (#104 · Q6 A).
 *
 * You type the times printed on the ticket; the airport code fills in the
 * zone. A bundled IATA → IANA table — no lookup API — so the answer is the
 * same on the server, in the browser and inside the phone's Hermes, offline.
 * A code the table does not list is not an error: the chip turns amber and
 * asks for a zone.
 *
 * Each row also carries the airport's coordinates, which is how a FERRY port
 * gets a zone: a port stop has coordinates but no zone, so it takes the zone
 * of the nearest listed airport (`zoneNearPoint` — Mykonos → JMK →
 * Europe/Athens).
 */

export interface Airport {
  /** IANA zone name ("America/Boise"). */
  tz: string;
  lat: number;
  lng: number;
}

/**
 * The table. Every airport the seeds fly (BOI · LAX · LIR · DFW · SEA · ATH ·
 * JMK · JNX) plus the hubs and leisure airports a household is likely to type.
 * Coordinates are to ~0.01°, which is all a nearest-airport lookup needs.
 */
export const AIRPORTS: Readonly<Record<string, Airport>> = {
  // ── the seeds ─────────────────────────────────────────────────────────────
  BOI: { tz: "America/Boise", lat: 43.56, lng: -116.22 },
  LAX: { tz: "America/Los_Angeles", lat: 33.94, lng: -118.41 },
  LIR: { tz: "America/Costa_Rica", lat: 10.59, lng: -85.54 },
  DFW: { tz: "America/Chicago", lat: 32.9, lng: -97.04 },
  SEA: { tz: "America/Los_Angeles", lat: 47.45, lng: -122.31 },
  ATH: { tz: "Europe/Athens", lat: 37.94, lng: 23.94 },
  JMK: { tz: "Europe/Athens", lat: 37.44, lng: 25.35 },
  JNX: { tz: "Europe/Athens", lat: 37.08, lng: 25.37 },
  // ── the Pacific Northwest and the West ────────────────────────────────────
  PDX: { tz: "America/Los_Angeles", lat: 45.59, lng: -122.6 },
  EUG: { tz: "America/Los_Angeles", lat: 44.12, lng: -123.21 },
  RDM: { tz: "America/Los_Angeles", lat: 44.25, lng: -121.15 },
  MFR: { tz: "America/Los_Angeles", lat: 42.37, lng: -122.87 },
  GEG: { tz: "America/Los_Angeles", lat: 47.62, lng: -117.53 },
  // #130 · the Bellingham replay's own airport (BOI → BLI).
  BLI: { tz: "America/Los_Angeles", lat: 48.79, lng: -122.54 },
  SFO: { tz: "America/Los_Angeles", lat: 37.62, lng: -122.38 },
  OAK: { tz: "America/Los_Angeles", lat: 37.72, lng: -122.22 },
  SJC: { tz: "America/Los_Angeles", lat: 37.36, lng: -121.93 },
  SMF: { tz: "America/Los_Angeles", lat: 38.7, lng: -121.59 },
  SAN: { tz: "America/Los_Angeles", lat: 32.73, lng: -117.19 },
  LAS: { tz: "America/Los_Angeles", lat: 36.08, lng: -115.15 },
  RNO: { tz: "America/Los_Angeles", lat: 39.5, lng: -119.77 },
  SLC: { tz: "America/Denver", lat: 40.79, lng: -111.98 },
  DEN: { tz: "America/Denver", lat: 39.86, lng: -104.67 },
  BZN: { tz: "America/Denver", lat: 45.78, lng: -111.15 },
  JAC: { tz: "America/Denver", lat: 43.61, lng: -110.74 },
  ABQ: { tz: "America/Denver", lat: 35.04, lng: -106.61 },
  PHX: { tz: "America/Phoenix", lat: 33.43, lng: -112.01 },
  TUS: { tz: "America/Phoenix", lat: 32.12, lng: -110.94 },
  ANC: { tz: "America/Anchorage", lat: 61.17, lng: -150.0 },
  HNL: { tz: "Pacific/Honolulu", lat: 21.32, lng: -157.92 },
  OGG: { tz: "Pacific/Honolulu", lat: 20.9, lng: -156.43 },
  KOA: { tz: "Pacific/Honolulu", lat: 19.74, lng: -156.05 },
  LIH: { tz: "Pacific/Honolulu", lat: 21.98, lng: -159.34 },
  // ── the rest of the US ────────────────────────────────────────────────────
  ORD: { tz: "America/Chicago", lat: 41.98, lng: -87.9 },
  MDW: { tz: "America/Chicago", lat: 41.79, lng: -87.75 },
  IAH: { tz: "America/Chicago", lat: 29.98, lng: -95.34 },
  AUS: { tz: "America/Chicago", lat: 30.19, lng: -97.67 },
  MSP: { tz: "America/Chicago", lat: 44.88, lng: -93.22 },
  MSY: { tz: "America/Chicago", lat: 29.99, lng: -90.26 },
  ATL: { tz: "America/New_York", lat: 33.64, lng: -84.43 },
  JFK: { tz: "America/New_York", lat: 40.64, lng: -73.78 },
  EWR: { tz: "America/New_York", lat: 40.69, lng: -74.17 },
  LGA: { tz: "America/New_York", lat: 40.78, lng: -73.87 },
  BOS: { tz: "America/New_York", lat: 42.36, lng: -71.01 },
  DCA: { tz: "America/New_York", lat: 38.85, lng: -77.04 },
  IAD: { tz: "America/New_York", lat: 38.95, lng: -77.46 },
  CLT: { tz: "America/New_York", lat: 35.21, lng: -80.94 },
  MIA: { tz: "America/New_York", lat: 25.79, lng: -80.29 },
  MCO: { tz: "America/New_York", lat: 28.43, lng: -81.31 },
  DTW: { tz: "America/Detroit", lat: 42.21, lng: -83.35 },
  // ── Canada ────────────────────────────────────────────────────────────────
  YVR: { tz: "America/Vancouver", lat: 49.19, lng: -123.18 },
  YYC: { tz: "America/Edmonton", lat: 51.13, lng: -114.01 },
  YYZ: { tz: "America/Toronto", lat: 43.68, lng: -79.63 },
  YUL: { tz: "America/Toronto", lat: 45.47, lng: -73.74 },
  // ── Mexico, Central America, the Caribbean ────────────────────────────────
  SJO: { tz: "America/Costa_Rica", lat: 9.99, lng: -84.2 },
  MEX: { tz: "America/Mexico_City", lat: 19.44, lng: -99.07 },
  CUN: { tz: "America/Cancun", lat: 21.04, lng: -86.87 },
  SJD: { tz: "America/Mazatlan", lat: 23.15, lng: -109.72 },
  PVR: { tz: "America/Mexico_City", lat: 20.68, lng: -105.25 },
  PTY: { tz: "America/Panama", lat: 9.07, lng: -79.38 },
  SJU: { tz: "America/Puerto_Rico", lat: 18.44, lng: -66.0 },
  // ── Europe ────────────────────────────────────────────────────────────────
  LHR: { tz: "Europe/London", lat: 51.47, lng: -0.45 },
  LGW: { tz: "Europe/London", lat: 51.15, lng: -0.19 },
  DUB: { tz: "Europe/Dublin", lat: 53.42, lng: -6.27 },
  CDG: { tz: "Europe/Paris", lat: 49.01, lng: 2.55 },
  AMS: { tz: "Europe/Amsterdam", lat: 52.31, lng: 4.76 },
  FRA: { tz: "Europe/Berlin", lat: 50.03, lng: 8.56 },
  MUC: { tz: "Europe/Berlin", lat: 48.35, lng: 11.79 },
  ZRH: { tz: "Europe/Zurich", lat: 47.46, lng: 8.55 },
  VIE: { tz: "Europe/Vienna", lat: 48.11, lng: 16.57 },
  MAD: { tz: "Europe/Madrid", lat: 40.47, lng: -3.57 },
  BCN: { tz: "Europe/Madrid", lat: 41.3, lng: 2.08 },
  LIS: { tz: "Europe/Lisbon", lat: 38.77, lng: -9.13 },
  FCO: { tz: "Europe/Rome", lat: 41.8, lng: 12.25 },
  IST: { tz: "Europe/Istanbul", lat: 41.26, lng: 28.74 },
  // ── Greece and its islands ────────────────────────────────────────────────
  JTR: { tz: "Europe/Athens", lat: 36.4, lng: 25.48 },
  HER: { tz: "Europe/Athens", lat: 35.34, lng: 25.18 },
  CHQ: { tz: "Europe/Athens", lat: 35.53, lng: 24.15 },
  RHO: { tz: "Europe/Athens", lat: 36.41, lng: 28.09 },
  CFU: { tz: "Europe/Athens", lat: 39.6, lng: 19.91 },
  JSI: { tz: "Europe/Athens", lat: 39.18, lng: 23.5 },
  PAS: { tz: "Europe/Athens", lat: 37.02, lng: 25.11 },
  MLO: { tz: "Europe/Athens", lat: 36.7, lng: 24.48 },
  SKG: { tz: "Europe/Athens", lat: 40.52, lng: 22.97 },
};

/**
 * Standard / daylight abbreviations for the zones the table uses. `Intl`'s
 * `timeZoneName: "short"` names North American zones ("MST", "PST") but, in
 * en-US, prints most others as "GMT+3" (vet MED: Athens in May is "EEST" in
 * the design, "GMT+3" from Intl). This fills exactly that gap, and it is the
 * fallback on a runtime (Hermes) whose Intl names none of them.
 */
const ZONE_ABBR: Readonly<Record<string, readonly [std: string, dst: string]>> = {
  "America/Boise": ["MST", "MDT"],
  "America/Denver": ["MST", "MDT"],
  "America/Phoenix": ["MST", "MST"],
  "America/Los_Angeles": ["PST", "PDT"],
  "America/Vancouver": ["PST", "PDT"],
  "America/Edmonton": ["MST", "MDT"],
  "America/Chicago": ["CST", "CDT"],
  "America/Costa_Rica": ["CST", "CST"],
  "America/Mexico_City": ["CST", "CST"],
  "America/Mazatlan": ["MST", "MST"],
  "America/Cancun": ["EST", "EST"],
  "America/Panama": ["EST", "EST"],
  "America/New_York": ["EST", "EDT"],
  "America/Detroit": ["EST", "EDT"],
  "America/Toronto": ["EST", "EDT"],
  "America/Puerto_Rico": ["AST", "AST"],
  "America/Anchorage": ["AKST", "AKDT"],
  "Pacific/Honolulu": ["HST", "HST"],
  "Europe/London": ["GMT", "BST"],
  "Europe/Dublin": ["GMT", "IST"],
  "Europe/Lisbon": ["WET", "WEST"],
  "Europe/Paris": ["CET", "CEST"],
  "Europe/Amsterdam": ["CET", "CEST"],
  "Europe/Berlin": ["CET", "CEST"],
  "Europe/Zurich": ["CET", "CEST"],
  "Europe/Vienna": ["CET", "CEST"],
  "Europe/Madrid": ["CET", "CEST"],
  "Europe/Rome": ["CET", "CEST"],
  "Europe/Athens": ["EET", "EEST"],
  "Europe/Istanbul": ["TRT", "TRT"],
};

/** The zone an airport code implies, or null when the table doesn't list it.
 * Case- and whitespace-forgiving: "lax " is LAX. */
export function zoneForAirport(code: string): string | null {
  return AIRPORTS[code.trim().toUpperCase()]?.tz ?? null;
}

/** Past this, "the nearest listed airport" is a guess, not a zone — the chip
 * asks instead. */
const NEAR_POINT_MAX_KM = 800;

/**
 * The zone of the nearest listed airport — how a ferry port (a stop with
 * coordinates and no zone) gets one. Null when nothing listed is within
 * reach, which renders the amber "pick a zone" chip.
 */
export function zoneNearPoint(lat: number, lng: number): string | null {
  let best: { tz: string; km: number } | null = null;
  for (const a of Object.values(AIRPORTS)) {
    const km = haversineKm(lat, lng, a.lat, a.lng);
    if (!best || km < best.km) best = { tz: a.tz, km };
  }
  return best && best.km <= NEAR_POINT_MAX_KM ? best.tz : null;
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Every zone the zone picker offers: the table's zones, A → Z. */
export function zoneChoices(): string[] {
  return [...new Set(Object.values(AIRPORTS).map((a) => a.tz))].sort();
}

/** Is this a zone the runtime can actually convert in? */
export function isKnownZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ── wall clock ⇄ instant ───────────────────────────────────────────────────

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;

/** The zone's offset from UTC at an instant, in minutes (east positive). */
function offsetMinutes(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour") % 24, n("minute"), n("second"));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/**
 * A ticket's wall clock ("2027-01-16 06:05") in its zone → the ISO instant
 * ("2027-01-16T13:05:00.000Z"). Null for a string that is not a wall clock or
 * a zone the runtime cannot convert in.
 *
 * Two passes, so a time near a DST change lands on the offset that is in
 * force AT that time rather than the one six hours earlier.
 */
export function localToInstant(local: string, tz: string): string | null {
  const m = LOCAL.exec(local.trim());
  if (!m || !isKnownZone(tz)) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  let ms = naive - offsetMinutes(naive, tz) * 60_000;
  ms = naive - offsetMinutes(ms, tz) * 60_000;
  return new Date(ms).toISOString();
}

/** An instant as the wall clock of a zone. */
export interface LocalTime {
  date: IsoDate;
  /** "06:05" — 24-hour, as a ticket prints it. */
  hhmm: string;
  /** "MST", "EEST" — see ZONE_ABBR for why this is not Intl's alone. */
  abbr: string;
}

export function instantToLocal(iso: string, tz: string): LocalTime {
  const zone = isKnownZone(tz) ? tz : "UTC";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).formatToParts(new Date(iso));
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = String(Number(v("hour")) % 24).padStart(2, "0");
  return {
    date: `${v("year")}-${v("month")}-${v("day")}`,
    hhmm: `${hour}:${v("minute")}`,
    abbr: zoneAbbr(iso, zone, v("timeZoneName")),
  };
}

/** "YYYY-MM-DD HH:MM" — how a form field holds an instant in its own zone. */
export function instantToLocalInput(iso: string, tz: string): string {
  const l = instantToLocal(iso, tz);
  return `${l.date} ${l.hhmm}`;
}

function zoneAbbr(iso: string, tz: string, intlName: string): string {
  // Intl's own letters when it has them ("MST", "PST", "CST").
  if (intlName && !/^(GMT|UTC)/.test(intlName)) return intlName;
  const pair = ZONE_ABBR[tz];
  if (!pair) return intlName || "UTC";
  // Daylight time is the larger of the year's two offsets — true in both
  // hemispheres, since it compares the instant to the zone's own standard.
  const year = Number(iso.slice(0, 4));
  const jan = offsetMinutes(Date.UTC(year, 0, 1), tz);
  const jul = offsetMinutes(Date.UTC(year, 6, 1), tz);
  const now = offsetMinutes(Date.parse(iso), tz);
  return now > Math.min(jan, jul) ? pair[1] : pair[0];
}

/** Minutes between two instants — a flight's time in the air, a layover. */
export function minutesBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000);
}
