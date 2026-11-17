/**
 * The `tz` cookie (#173 · #172 · Q3 C): the browser's IANA zone, so the server
 * can answer "today" in the traveler's calendar when `/` picks a landing.
 *
 * Written by the browser (`PrefSync` keeps it in step, `LandingStep` sets it on
 * the first visit), read on the server by `app/page.tsx` through
 * `isoDateInZone`, which rejects anything that is not a zone.
 */
export const TZ_COOKIE = "tz";

const ONE_YEAR_S = 60 * 60 * 24 * 365;

/** The `document.cookie` assignment for `zone`: site-wide, a year, Lax. */
export function tzCookie(zone: string): string {
  return `${TZ_COOKIE}=${zone}; path=/; max-age=${ONE_YEAR_S}; SameSite=Lax`;
}

/** One cookie's value out of a `document.cookie` string, or null. */
export function readCookie(cookieString: string, name: string): string | null {
  for (const part of cookieString.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}
