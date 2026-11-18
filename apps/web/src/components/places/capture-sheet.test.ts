import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #176 i3 · #175 · Q7 B — + Capture opens the PlaceSheet in capture mode over
 * any page (docs/design/176 §3–§4).
 *
 * Asserted as source, the way nav.test.ts reads Nav.tsx: these components pull
 * in sonner, the PlacePicker and next/navigation, and this vitest has no DOM to
 * render them into. The decisions they wire (captureTarget, matchingOpenIdea,
 * checkOffBody, pickedDidItBody, checkOffUndo) are unit-tested in
 * packages/core. What a browser must prove (the sheet over /trips/:id, /map
 * and /places in both themes; sonner's Undo) is the walk's.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "../..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

/** Source with comments stripped, so a comment cannot satisfy a claim. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const flat = (s: string) => s.replace(/\s+/g, " ");

const capture = flat(code(read("components/places/CaptureSheet.tsx")));
const sheet = flat(code(read("components/places/PlaceSheet.tsx")));
const shellSrc = read("components/places/SheetShell.tsx");
const shell = flat(code(shellSrc));
const planner = flat(code(read("components/trip/TripPlanner.tsx")));
const workspace = flat(code(read("components/places/PlacesWorkspace.tsx")));
const api = flat(code(read("lib/trip-api.ts")));

describe("CaptureSheet.tsx — where a capture files", () => {
  it("is a client component", () => {
    expect(read("components/places/CaptureSheet.tsx").trimStart().startsWith('"use client"')).toBe(true);
  });

  it("finds the trip with activeTrip over GET /api/trips, on the browser's localIsoDate()", () => {
    expect(capture).toContain("await tripApi.listTrips()");
    expect(capture).toContain("activeTrip(list, localIsoDate())");
  });

  it("then takes captureTarget over that trip's bundle, on localIsoDate()", () => {
    expect(capture).toContain("await tripApi.getTrip(trip.id)");
    expect(capture).toContain("captureTarget([bundle.trip], localIsoDate())");
  });

  it("opens on Been here once a trip resolves, unless the switch was touched", () => {
    expect(capture).toContain("if (!touched.current) setLogging(true)");
  });
});

describe("CaptureSheet.tsx — the Been here write", () => {
  const log = capture.slice(capture.indexOf("const submitLog"), capture.indexOf("const submitLibrary"));

  it("matches against the destination's ideas, else the shelf", () => {
    expect(log).toContain("const ideas = destination ? destination.ideas : trip.ideas");
  });

  it("calls matchingOpenIdea BEFORE choosing PATCH vs POST", () => {
    const match = log.indexOf("matchingOpenIdea(ideas, placeOf(picked))");
    const patch = log.indexOf("tripApi.updateIdea(match.id, patch)");
    const post = log.indexOf("tripApi.createIdea(body)");
    expect(match).toBeGreaterThan(-1);
    expect(patch).toBeGreaterThan(match);
    expect(post).toBeGreaterThan(match);
    expect(log).toContain("if (match) {");
    expect(log).toContain("const patch = checkOffBody(answers)");
  });

  it("sends destinationId null when the target has no destination", () => {
    expect(log).toContain("pickedDidItBody( { tripId: trip.id, destinationId: destination?.id ?? null }, picked, answers, )");
  });

  it("toasts 'In your journal' (journalToast) with an Undo on both paths", () => {
    expect(log).toContain("journalToast(trip.title)");
    expect(log.match(/label: "Undo"/g)).toHaveLength(2);
    // Undo of a check-off PATCHes the before-state back; of a create, DELETEs.
    expect(log).toContain("const before = checkOffUndo(match)");
    expect(log).toContain("tripApi .updateIdea(match.id, before)");
    expect(log).toContain("tripApi .deleteIdea(idea.id)");
  });

  it("dispatches rv:captured for the write AND for its Undo (vet MED)", () => {
    expect(capture).toContain('window.dispatchEvent(new CustomEvent("rv:captured", { detail }))');
    expect(log).toContain('emit({ kind: "idea-patch", tripId: trip.id, id: match.id, patch })');
    expect(log).toContain('emit({ kind: "idea-patch", tripId: trip.id, id: match.id, patch: before })');
    expect(log).toContain('emit({ kind: "idea", tripId: trip.id, idea })');
    expect(log).toContain('emit({ kind: "idea-removed", tripId: trip.id, id: idea.id, destinationId: idea.destinationId })');
  });

  it("closes on success and never navigates", () => {
    expect(capture).toContain("onClose();");
    expect(capture).not.toContain("router.push");
    expect(capture).not.toContain("useRouter");
  });
});

describe("CaptureSheet.tsx — the library save", () => {
  const lib = capture.slice(capture.indexOf("const submitLibrary"), capture.indexOf("const submit = "));

  it("is today's savePlaceBody POST, then rv:captured { kind: 'place' } and savedToast", () => {
    expect(lib).toContain("savePlaceBody(form, areaLabel)");
    expect(lib).toContain("await tripApi.savePlace(body)");
    expect(lib).toContain('emit({ kind: "place", place })');
    expect(lib).toContain("savedToast(place)");
  });

  it("routes Been here to the journal only when a trip resolved", () => {
    expect(capture).toContain("target && logging ? submitLog(target) : submitLibrary()");
  });
});

describe("PlaceSheet.tsx — capture mode", () => {
  it("draws the DS SegmentedControl: Been here · Want to go mid-trip", () => {
    expect(sheet).toMatch(
      /<SegmentedControl value=\{logging \? "did" : "want"\} options=\{\[ \{ value: "did", label: "Been here" \}, \{ value: "want", label: "Want to go" \}, \]\}/,
    );
  });

  it("draws Want to go · Been there on form.status outside a trip", () => {
    expect(sheet).toMatch(
      /<SegmentedControl value=\{form\.status\} options=\{\[ \{ value: "want", label: "Want to go" \}, \{ value: "been", label: "Been there" \}, \]\}/,
    );
  });

  // #186 i9 (#160): a new /places save now draws Want to go · Been there too
  // (been-sheet.test.ts); only the edit sheet (capture absent) draws none.
  it("draws no switch on the /places edit sheet (capture absent, mode edit)", () => {
    expect(sheet).toContain('const libraryStatus = capture === null || (capture === undefined && mode === "save")');
    expect(sheet).toContain(") : capture ? (");
    expect(sheet).toContain(") : null; if (log) {");
  });

  it("Been here: the context line, Stars at 26, the Again pair and the note", () => {
    const log = sheet.slice(sheet.indexOf("if (log) {"), sheet.indexOf("return ( <SheetShell kicker={capture ?"));
    expect(log).toContain("didItContext(capture.trip.title, capture.destination?.name ?? null)");
    expect(log).toContain('<SheetField label="How was it"> <Stars value={answers.rating ?? 0} size={26} onSet=');
    expect(log).toContain('<SheetField label="Do it again?"> <AgainPair');
    expect(log).toContain("toggleAgain(answers.again, t)");
    expect(log).toContain('placeholder="For next time…"');
  });

  it("Been here's copy is the frame's: trip kicker, 'Capture', green logCtaLabel, saves to · journal", () => {
    const log = sheet.slice(sheet.indexOf("if (log) {"));
    expect(log).toContain("kicker={capture.trip.title}");
    expect(log).toContain('title="Capture"');
    expect(log).toContain('hint="saves to · journal"');
    expect(log).toContain("submitLabel={logCtaLabel(capture.trip.title)}");
    expect(log).toContain('submitTone="green"');
  });

  it("the library body keeps 'Save to library' and the accent default; no trip keeps 'Your saves'", () => {
    const lib = sheet.slice(sheet.indexOf("return ( <SheetShell kicker={capture ?"));
    expect(lib).toContain('kicker={capture ? capture.trip.title : "Your saves"}');
    expect(lib).toContain('title={capture ? "Capture" : mode === "save" ? "Save a place" : "Edit place"}');
    expect(lib).toContain('submitLabel="Save to library"');
    expect(lib).not.toContain("submitTone");
  });

  it("the Again pair's on tones are the wireframe's", () => {
    expect(sheet).toContain('value === true ? "border-rv-ink bg-rv-navy-soft text-rv-ink" : off');
    expect(sheet).toContain('value === false ? "border-rv-warning bg-rv-warning-soft text-rv-warning" : off');
  });
});

describe("SheetShell.tsx — submitTone", () => {
  it("defaults to accent, so the /places sheets are unchanged", () => {
    expect(shell).toContain('submitTone = "accent"');
  });

  it("keeps each fill on one line with its ink (the nightfall sweeps are line-based)", () => {
    const lines = shellSrc.split("\n");
    expect(lines.some((l) => /accent: "bg-rv-accent-deep text-rv-accent-ink"/.test(l))).toBe(true);
    expect(lines.some((l) => /green: "bg-rv-green text-rv-navy"/.test(l))).toBe(true);
    expect(shell).toContain("SUBMIT_TONE[submitTone]");
  });
});

describe("the pages under the sheet listen for rv:captured", () => {
  it("TripPlanner splices idea / idea-patch / idea-removed for its own trip", () => {
    expect(planner).toContain('window.addEventListener("rv:captured", onCaptured)');
    expect(planner).toContain('window.removeEventListener("rv:captured", onCaptured)');
    expect(planner).toContain("if (d.tripId !== t.id) return t;");
    expect(planner).toContain("appendIdea(t, d.idea.destinationId, d.idea) : appendShelfIdea(t, d.idea)");
    expect(planner).toContain("setIdeaFields(t, d.id, d.patch)");
    expect(planner).toContain("removeIdea(t, d.destinationId, d.id) : removeShelfIdea(t, d.id)");
  });

  it("PlacesWorkspace appends a captured place (shipped is append)", () => {
    expect(workspace).toContain('window.addEventListener("rv:captured", onCaptured)');
    expect(workspace).toContain('if (d.kind !== "place") return;');
    expect(workspace).toContain("[...ps, d.place]");
  });
});

describe("trip-api.ts — the sheet's two reads (vet MED)", () => {
  it("lists trips and reads one bundle", () => {
    expect(api).toContain("listTrips: (): Promise<TripSummary[]> => req(`/api/trips`, \"GET\")");
    expect(api).toContain("req(`/api/trips/${id}`, \"GET\")");
  });
});
