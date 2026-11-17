import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #173 i4 · #172 · Q3 C — the landing rule. The trips list moves to /trips, and
 * `/` redirects by the browser's date: into the trip in progress, else /places.
 *
 * Asserted as source, the way nav.test.ts reads the shell: these files pull in
 * next/headers, next/navigation and the database, and this vitest has no DOM
 * or request scope to run them in. The date logic itself (activeTrip,
 * isoDateInZone) is covered in packages/core's journal.test.ts.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** Comments stripped, whitespace collapsed, so a hard-wrapped call still matches. */
const flat = (s: string) => code(s).replace(/\s+/g, " ");

describe("the trips list lives at /trips", () => {
  it("app/trips/page.tsx holds the list, unchanged", () => {
    const list = flat(read("app/trips/page.tsx"));
    expect(list).toContain("listTripsForOwner(owner)");
    expect(list).toContain("Where to next?");
    expect(list).toContain("<TripCard");
    expect(list).toContain("units={units}");
  });
});

describe("/ redirects by the browser's date", () => {
  const page = flat(read("app/page.tsx"));

  it("is a dynamic server page that reads the owner's trips and the tz cookie", () => {
    expect(page).not.toContain('"use client"');
    expect(page).toContain('export const dynamic = "force-dynamic"');
    expect(page).toContain("listTripsForOwner(owner)");
    expect(page).toContain('from "next/headers"');
    expect(page).toContain("cookies()");
    expect(page).toContain(".get(TZ_COOKIE)");
  });

  it("redirects to the active trip, else /places, when the zone is valid", () => {
    expect(page).toContain("isoDateInZone(new Date(), tz)");
    expect(page).toContain("activeTrip(trips, today)");
    expect(page).toContain("redirect(active ? `/trips/${active.id}` : \"/places\")");
  });

  it("falls back to LandingStep, handing it only id and dates", () => {
    expect(page).toContain("<LandingStep");
    expect(page).toContain("({ id, startDate, endDate }) => ({ id, startDate, endDate })");
    expect(page).not.toContain("<PageShell");
  });

  it("LandingStep writes the cookie, computes the local date and replaces", () => {
    const step = read("components/nav/LandingStep.tsx");
    expect(step.trimStart().startsWith('"use client"')).toBe(true);
    const s = flat(step);
    expect(s).toContain("document.cookie = tzCookie(");
    expect(s).toContain("activeTrip(trips, localIsoDate())");
    expect(s).toContain("router.replace(active ? `/trips/${active.id}` : \"/places\")");
    expect(s).toContain("return null");
  });

  it("PrefSync keeps the cookie in step with the browser's zone", () => {
    const s = flat(read("components/nav/PrefSync.tsx"));
    expect(s).toContain("Intl.DateTimeFormat().resolvedOptions().timeZone");
    expect(s).toContain("readCookie(document.cookie, TZ_COOKIE) !== zone");
    expect(s).toContain("document.cookie = tzCookie(zone)");
  });
});

describe("callers that mean the trips list go to /trips", () => {
  it.each([
    ["app/trips/new/page.tsx", 'router.push("/trips")'],
    ["components/trip/TripPlanner.tsx", 'router.push("/trips")'],
    ["components/join/JoinAccept.tsx", 'onClick={() => router.push("/trips")}'],
  ])("%s", (file, call) => {
    const s = flat(read(file));
    expect(s).toContain(call);
    expect(s).not.toContain('router.push("/")');
  });

  it("JoinAccept's post-join replace stays an entry at /", () => {
    expect(flat(read("components/join/JoinAccept.tsx"))).toContain('router.replace("/")');
  });

  it("no app/page.tsx sibling keeps the old list", () => {
    expect(existsSync(join(SRC, "app/trips/page.tsx"))).toBe(true);
    expect(flat(read("app/page.tsx"))).not.toContain("<TripCard");
  });
});
