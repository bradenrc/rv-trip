import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #197 · #195 — every way into the Place screen on the phone (docs/design/197
 * §4 frames 9–12), read as source.
 *
 * `apps/mobile` has no test runner, so this follows mobile-place-screen.test.ts:
 * the Journal match rule is unit tested in capture/place-screen.test.ts
 * (`saveForJournalEntry`); what is pinned HERE is that each entry point pushes
 * `/place/[id]`. That the push lands, Back returns to the same scroll, and the
 * Map tab raises the pin is the walk's.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(REPO, "apps/mobile", p), "utf8");
/** Source with comments stripped, so a comment cannot satisfy a claim. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const flat = (s: string) => s.replace(/\s+/g, " ");

const PUSH = /router\.push\(\{ pathname: "\/place\/\[id\]", params: \{ id: [\w.]+(, from: "\w+")? \} \}\)/;

describe("Places rows open the Place screen (frame 9)", () => {
  const saves = flat(code(read("app/(tabs)/saves.tsx")));

  it("each library row is a Pressable that pushes /place/[id] from Places", () => {
    expect(saves).toContain('router.push({ pathname: "/place/[id]", params: { id: s.id, from: "Places" } })');
  });

  it("draws a press state (navy-soft) and a › in ink-subtle", () => {
    expect(saves).toMatch(/pressed && styles\.rowPressed/);
    expect(saves).toMatch(/rowPressed: \{ backgroundColor: C\.navySoft \}/);
    expect(saves).toContain("<Text style={styles.chev}>›</Text>");
    expect(saves).toMatch(/chev: \{ color: C\.inkSubtle, fontSize: 14 \}/);
  });

  it("keeps the suggestion strip as its own buttons, outside the rows", () => {
    expect(saves).toContain("s.suggestedPlace ? <Suggestion key={`sp_${s.id}`} save={s} /> : null");
  });
});

describe("Map tab: the saved-pin card opens it, and a place param selects the pin (frame 10)", () => {
  const map = flat(code(read("app/(tabs)/map.tsx")));

  it("the saved-pin card is a Pressable pushing /place/[id] from Map, with Open →", () => {
    expect(map).toContain('router.push({ pathname: "/place/[id]", params: { id: save.id, from: "Map" } })');
    expect(map).toContain("Open →");
    expect(map).toMatch(/cardOpen: \{[^}]*color: C\.accent/);
  });

  it("the destination card keeps Trip →", () => {
    expect(map).toContain("Trip →");
    expect(map).toContain("router.push(`/trips/${dest.tripId}`)");
  });

  it("reads the place search param in an effect keyed on it, selects it under All, then clears the param", () => {
    expect(map).toContain("const { place } = useLocalSearchParams<{ place?: string }>();");
    expect(map).toMatch(
      /useEffect\(\(\) => \{ if \(!place\) return; setPicked\(\{ kind: "all" \}\); setSelectedId\(place\); router\.setParams\(\{ place: undefined \}\); \}, \[place, router\]\);/,
    );
  });

  it("clears the selection once the selected save is gone from the library", () => {
    expect(map).toContain("if (loaded && selectedId !== null && !dest && !save) setSelectedId(null);");
  });
});

describe("Journal entries matched to a save open it (frame 11)", () => {
  const journal = flat(code(read("src/journal.tsx")));

  it("matches by core's saveForJournalEntry over the library", () => {
    expect(journal).toContain("const { saves } = useSaves();");
    expect(journal).toContain("const match = saveForJournalEntry(e, saves);");
  });

  it("a matched entry's › pushes /place/[id] from Trip; an unmatched one draws no ›", () => {
    expect(journal).toContain('router.push({ pathname: "/place/[id]", params: { id: match.id, from: "Trip" } })');
    expect(journal).toMatch(/\{match \? \( <Pressable[^]*?<Text style=\{styles\.chev\}>›<\/Text> <\/Pressable> \) : null\}/);
  });

  it("keeps the shipped row tap: select the pin, then open the How was it? sheet", () => {
    expect(journal).toMatch(/onPress=\{\(\) => \{ onSelect\?\.\(e\.id\); onOpen\(e\); \}\}/);
  });
});

describe("the saved capture toast gains View (frame 12)", () => {
  const runtime = flat(code(read("src/capture.ts")));

  it("the saved tone passes onView, opening its undoId", () => {
    expect(runtime).toContain(
      'showToast(savedToast(mine), "saved", { undoId: mine.id, onView: () => { dismissToast(); router.push({ pathname: "/place/[id]", params: { id: mine.id } }); }, });',
    );
  });

  it("the queued tones carry no View — a queued save has no id yet", () => {
    const queued = [...runtime.matchAll(/showToast\([^;]*"(queued|journal-queued)"[^;]*\);/g)];
    expect(queued.length).toBeGreaterThan(0);
    for (const m of queued) expect(m[0]).not.toContain("onView");
  });
});

describe("every entry point uses one push shape", () => {
  it("saves.tsx, map.tsx and journal.tsx each push /place/[id]", () => {
    for (const f of ["app/(tabs)/saves.tsx", "app/(tabs)/map.tsx", "src/journal.tsx"]) {
      expect(flat(code(read(f)))).toMatch(PUSH);
    }
  });
});
