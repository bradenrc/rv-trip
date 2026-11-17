import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #178 · #181 i4 — the web's mid-trip Journal and the door into Nav's
 * capture sheet, read as source (this vitest has no DOM; the projections are
 * unit tested in packages/core: up-next.test.ts and journal.test.ts).
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "../..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
/** Source with comments stripped, so a comment cannot satisfy a claim. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const flat = (s: string) => s.replace(/\s+/g, " ");
const lens = flat(code(read("components/trip/JournalLens.tsx")));
const nav = flat(code(read("components/nav/Nav.tsx")));
const planner = flat(code(read("components/trip/TripPlanner.tsx")));

describe("web JournalLens · mid-trip (#178)", () => {
  it("gates the mid-trip form on activeTrip and a visit-local whole flag", () => {
    expect(lens).toContain("const midTrip = today !== null && activeTrip([trip], today) !== null;");
    expect(lens).toContain("const [whole, setWhole] = useState(false);");
    expect(lens).toContain("midTrip && !whole ? (");
  });

  it("reads core's upNext and journalToday on a clock it re-reads every 60 s", () => {
    expect(lens).toContain("upNext(trip, new Date(clock), today)");
    expect(lens).toContain("journalToday(trip, today)");
    expect(lens).toContain("const [clock, setClock] = useState(now);");
    expect(lens).toContain("setInterval(() => setClock(new Date().toISOString()), 60_000)");
    expect(lens).toContain("clearInterval(");
  });

  it("Log something is bg-rv-green text-rv-navy and dispatches rv:capture", () => {
    expect(lens).toMatch(/className="[^"]*\bbg-rv-green\b[^"]*\btext-rv-navy\b[^"]*"/);
    expect(lens).toContain("＋ Log something");
    expect(lens).toContain('window.dispatchEvent(new CustomEvent("rv:capture"))');
  });

  it("stays read-only: no toRate, no How was it?", () => {
    expect(lens).not.toContain("toRate");
    expect(lens).not.toContain("How was it?");
  });

  it("puts the i2 Navigate links on the card's drives", () => {
    expect(lens).toContain("<NavigateLinks drive={nextDrive}");
    expect(lens).toContain("<NavigateLinks drive={thenDrive}");
    expect(lens).toContain("<RvRouteLine drive={nextDrive} rigOn={trip.rigOn}");
    expect(lens).toContain("<RvRouteLine drive={thenDrive} rigOn={trip.rigOn}");
    expect(lens).toContain("upNextThenLine(up.then)");
  });

  it("swaps to the whole trip and back", () => {
    expect(lens).toContain("Whole trip and map →");
    expect(lens).toContain("‹ Today");
    expect(lens).toContain("onWhole={() => setWhole(true)}");
    expect(lens).toContain("onToday={midTrip ? () => setWhole(false) : null}");
    expect(lens).toContain("onClick={onWhole}");
    expect(lens).toContain("onClick={onToday}");
    expect(lens).toContain("Nothing logged here yet.");
  });

  it("TripPlanner passes today, now and the route's drives", () => {
    expect(planner).toContain("const drives = useMemo(() => routeDrives(route), [route]);");
    expect(planner).toMatch(/<JournalLens trip=\{trip\} today=\{today\} now=\{now \?\? new Date\(\)\.toISOString\(\)\} drives=\{drives\}/);
  });
});

describe("Nav opens the CaptureSheet on rv:capture (#178)", () => {
  it("adds and removes the window listener", () => {
    expect(nav).toContain("const onCapture = () => setCapturing(true);");
    expect(nav).toContain('window.addEventListener("rv:capture", onCapture);');
    expect(nav).toContain('return () => window.removeEventListener("rv:capture", onCapture);');
    expect(nav).toContain("{capturing ? <CaptureSheet onClose={() => setCapturing(false)} /> : null}");
  });
});
