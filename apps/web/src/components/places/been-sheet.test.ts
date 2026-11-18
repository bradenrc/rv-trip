import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #186 i9 · #160 renders · q10 A (docs/design/186 §6): a new save starts on the
 * shelf you're viewing, and on Been there it asks how it was and which trip.
 *
 * Read as source, the way capture-sheet.test.ts reads the sheets: this vitest
 * has no DOM, and the sheets pull in sonner and the PlacePicker. The rules
 * (emptySavePlaceForm's shelf, savePlaceBody's memory, tripsNearPlace,
 * tripNearInputs) are unit tested in packages/core. What a browser must prove
 * (the switch and the reveal drawn in both themes) is the walk's.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "../..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const flat = (s: string) => s.replace(/\s+/g, " ");

const sheet = flat(code(read("components/places/PlaceSheet.tsx")));
const workspace = flat(code(read("components/places/PlacesWorkspace.tsx")));
const library = flat(code(read("components/places/PlacesLibrary.tsx")));
const page = flat(code(read("app/places/page.tsx")));

describe("PlacesLibrary — reports its shelf up", () => {
  it("takes an onShelfChange prop and calls it when the shelf switches", () => {
    expect(library).toContain("onShelfChange?: (status: SavedPlaceStatus) => void");
    const change = library.slice(library.indexOf("const changeStatus"));
    expect(change).toMatch(/^const changeStatus = \(s: SavedPlaceStatus\) => \{ setStatus\(s\); onShelfChange\?\.\(s\);/);
  });
});

describe("PlacesWorkspace — Save a place opens on the library's shelf", () => {
  it("holds the shelf PlacesLibrary reports", () => {
    expect(workspace).toContain('const [libraryShelf, setLibraryShelf] = useState<SavedPlaceStatus>("want")');
    expect(workspace).toContain("onShelfChange={setLibraryShelf}");
  });

  it("seeds openSaveSheet with emptySavePlaceForm(the library shelf)", () => {
    const open = workspace.slice(workspace.indexOf("const openSaveSheet"), workspace.indexOf("const changeSaveForm"));
    expect(open).toContain("setSaveSheet({ id: null, form: emptySavePlaceForm(libraryShelf) })");
    expect(workspace).not.toContain("emptySavePlaceForm()");
  });

  it("narrows the page's nearTrips with tripsNearPlace over the picked point", () => {
    expect(workspace).toContain("tripsNearPlace(nearTrips, pointOf(saveSheet?.form.picked ?? null))");
    expect(workspace).toContain("nearTrips={near}");
  });
});

describe("places/page.tsx — the Which trip? input", () => {
  it("passes tripNearInputs over the full trees, never the trees themselves", () => {
    expect(page).toContain("const nearTrips = tripNearInputs(trips)");
    expect(page).toContain("nearTrips={nearTrips}");
    expect(page).not.toMatch(/PlacesWorkspace[^>]*trips=\{trips\}/);
  });
});

describe("PlaceSheet — the shelf switch and the been fields", () => {
  it("draws Want to go · Been there for a save without capture, and under + Capture with no trip", () => {
    expect(sheet).toContain('const libraryStatus = capture === null || (capture === undefined && mode === "save")');
    expect(sheet).toMatch(
      /libraryStatus \? \( <div className="self-start"> <SegmentedControl value=\{form\.status\} options=\{\[ \{ value: "want", label: "Want to go" \}, \{ value: "been", label: "Been there" \}, \]\}/,
    );
  });

  it("under status been: How was it (Stars 26 on form.rating), then Which trip? when near trips exist", () => {
    expect(sheet).toContain('const been = libraryStatus && form.status === "been"');
    const lib = sheet.slice(sheet.indexOf("return ( <SheetShell kicker={capture ?"));
    const reveal = lib.slice(lib.indexOf("{been ? ("), lib.indexOf('<SheetField label="Region"'));
    expect(reveal).toContain('<SheetField label="How was it"> <Stars value={form.rating} size={26} onSet={(n) => onChange({ ...form, rating: n })} />');
    expect(reveal).toContain('{nearTrips.length > 0 ? ( <SheetField label="Which trip?"');
    expect(reveal).toContain('<option value="">None · before the app</option>');
    expect(reveal).toContain("{t.title} · {t.dates}");
    expect(reveal).toContain("onChange({ ...form, tripId: e.target.value })");
    // The reveal is drawn before Region, and Who told you stays want-only.
    expect(lib.indexOf("{been ? (")).toBeLessThan(lib.indexOf('<SheetField label="Region"'));
    expect(lib).toContain('{form.status === "want" ? ( <SheetField label="Who told you"');
  });

  it("takes nearTrips as an optional prop, empty by default (Nav's + Capture holds none)", () => {
    expect(sheet).toContain("nearTrips = NO_TRIPS");
    expect(sheet).toContain("nearTrips?: TripNear[]");
  });

  it("the reveal's rule is a token, on one line", () => {
    expect(read("components/places/PlaceSheet.tsx")).toMatch(/className="flex flex-col gap-2 border-l-\[3px\] border-rv-green pl-\[10px\]"/);
  });
});
