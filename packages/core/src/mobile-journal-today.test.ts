import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #178 · #181 i4 — the phone's mid-trip Journal, read as source.
 *
 * `apps/mobile` has no test runner, so this follows mobile-navigate.test.ts:
 * the projections are unit tested in planner/up-next.test.ts (`upNext`,
 * `upNextThenLine`) and planner/journal.test.ts (`journalToday`); what is
 * pinned HERE is that `JournalView` reads them, gates the form on
 * `activeTrip`, and wires Log something, the whole-trip swap and the
 * "How was it?" pill. How it looks on a device is the walk's.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(REPO, "apps/mobile", p), "utf8");
/** Source with comments stripped, so a comment cannot satisfy a claim. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const flat = (s: string) => s.replace(/\s+/g, " ");
const journal = flat(code(read("src/journal.tsx")));
const tripScreen = flat(code(read("app/(tabs)/(trips)/trips/[id]/index.tsx")));

describe("phone JournalView · mid-trip (#178)", () => {
  it("gates the mid-trip form on activeTrip and the visit-local whole flag", () => {
    expect(journal).toContain("const midTrip = activeTrip([trip], today) !== null;");
    expect(journal).toContain("const [whole, setWhole] = useState(false);");
    expect(journal).toContain("midTrip && !whole ? (");
  });

  it("reads core's upNext and journalToday", () => {
    expect(journal).toContain("const up = upNext(trip, now, today);");
    expect(journal).toContain("const j = journalToday(trip, today);");
    expect(journal).toContain("upNextThenLine(up.then)");
  });

  it("puts Navigate on next when it has somewhere to go, and on a drive 'then'", () => {
    expect(journal).toContain("up.next.navTo && nextDrive");
    // Only drive segments are in `drives` (core's routeDrives), so the lookup
    // alone keeps Navigate off a fly or ferry "then".
    expect(journal).toContain('up?.then ? (drives.get(up.then.segmentId ?? "") ?? null) : null');
    expect(journal).toMatch(/<NavigateLinks drive=\{nextDrive\} rigOn=\{trip\.rigOn\}/);
    expect(journal).toMatch(/<NavigateLinks drive=\{thenDrive\} rigOn=\{trip\.rigOn\}/);
  });

  it("renders Up next only when upNext is non-null", () => {
    expect(journal).toContain("{up && (");
    expect(journal).toContain(">Up next</Text>");
  });

  it("draws the Log something CTA in C.green with navy text and calls onLog", () => {
    expect(journal).toContain("＋ Log something");
    expect(journal).toMatch(/logCta: \{[^}]*backgroundColor: C\.green[,\s]/);
    expect(journal).toMatch(/logCtaText: \{[^}]*color: C\.navy/);
    expect(journal).toContain("onPress={onLog}");
  });

  it("the trip screen's onLog pushes /capture", () => {
    expect(tripScreen).toContain('onLog={() => router.push("/capture")}');
  });

  it("opens the shipped HowWasItSheet from a toRate row", () => {
    expect(journal).toContain("How was it?</Text>");
    expect(journal).toContain("onPress={() => onOpen(reservationEntry(r))}");
    expect(journal).toMatch(/how: \{[^}]*borderColor: C\.borderHi/);
    expect(journal).toMatch(/howText: \{[^}]*color: C\.greenInk/);
    // …and the trip screen's onOpen is what shows the sheet.
    expect(tripScreen).toContain("if (!isProvisionalIdea(e)) setJournalEntry(e);");
    expect(tripScreen).toContain("<HowWasItSheet visible={journalEntry !== null}");
  });

  it("swaps to the whole trip and back, in place", () => {
    expect(journal).toContain("Whole trip and map →");
    expect(journal).toContain("onWhole={() => setWhole(true)}");
    expect(journal).toContain("<Pressable onPress={onWhole}");
    expect(journal).toContain("‹ Today");
    expect(journal).toContain("onToday={midTrip ? () => setWhole(false) : null}");
  });

  it("shows the empty copy when Today has nothing", () => {
    expect(journal).toContain("Nothing logged here yet.");
  });

  it("the trip screen passes today, a focus-refreshed now, the route drives and onLog", () => {
    expect(tripScreen).toContain("const drives = useMemo(() => routeDrives(chapters), [chapters]);");
    expect(tripScreen).toContain("useFocusEffect( useCallback(() => { setNow(new Date()); }, []), );");
    expect(tripScreen).toMatch(/<JournalView trip=\{trip\} today=\{localIsoDate\(\)\} now=\{now\} drives=\{drives\}/);
  });
});
