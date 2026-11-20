import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #197 · #196 (docs/design/197 §5): /places/[id] on the web — the Place view as
 * a sheet, two routes into it, and "Open" on the pin cards.
 *
 * Read as source, the way been-sheet.test.ts reads the sheets: this vitest has
 * no DOM, and the components pull in sonner, mapbox and next/navigation. The
 * rules (navigateLinksForPlace, the copy helpers, saveForJournalEntry) are unit
 * tested in packages/core. What only a browser can prove — Next's interception
 * on a soft navigation vs a hard load, and the pixels — is the walk's.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "../..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const flat = (s: string) => s.replace(/\s+/g, " ");
const src = (p: string) => flat(code(read(p)));

const MODAL_PAGE = "app/@modal/(.)places/[id]/page.tsx";
const DIRECT_PAGE = "app/places/[id]/page.tsx";

describe("the routes", () => {
  it("adds the @modal slot's null default and a null catch-all", () => {
    for (const p of ["app/@modal/default.tsx", "app/@modal/[...catchAll]/page.tsx"]) {
      expect(existsSync(join(SRC, p)), p).toBe(true);
      expect(src(p)).toMatch(/export default function \w+\(\) \{ return null; \}/);
    }
  });

  it("renders the modal slot in the root layout", () => {
    const layout = src("app/layout.tsx");
    expect(layout).toMatch(/children, modal, \}/);
    expect(layout).toContain("modal: React.ReactNode;");
    expect(layout).toMatch(/\{children\} \{modal\}/);
  });

  it.each([MODAL_PAGE, DIRECT_PAGE])("%s awaits params, finds the save and calls notFound() otherwise", (p) => {
    expect(existsSync(join(SRC, p))).toBe(true);
    const page = src(p);
    expect(page).toContain("params: Promise<{ id: string }>");
    expect(page).toContain("const { id } = await params;");
    expect(page).toContain("placeViewFor(await getOwner(), id)");
    expect(page).toMatch(/if \(!found\) notFound\(\);/);
    expect(page).toContain('import { notFound } from "next/navigation";');
  });

  it("looks the save up in the owner's own list (no single-place read exists)", () => {
    const lib = src("lib/place-view.ts");
    expect(lib).toContain("(await listSavedPlacesForOwner(owner)).find((p) => p.id === id) ?? null");
    expect(lib).toMatch(/if \(!save\) return null;/);
  });

  it("closes with router.back() when intercepted, and to /places on a direct load over the library", () => {
    expect(src(MODAL_PAGE)).toContain('close="back"');
    const direct = src(DIRECT_PAGE);
    expect(direct).toContain('close="/places"');
    expect(direct).toContain('import PlacesPage from "../page";');
    expect(direct.indexOf("<PlacesPage />")).toBeLessThan(direct.indexOf("<PlaceView"));
    const view = src("components/places/PlaceView.tsx");
    expect(view).toContain('close === "back" ? router.back() : router.push("/places")');
  });
});

describe("SheetShell — the footer is optional", () => {
  const shell = src("components/places/SheetShell.tsx");

  it("makes onSubmit, submitLabel and hint optional, and draws the footer only with onSubmit", () => {
    expect(shell).toContain("onSubmit?: () => void;");
    expect(shell).toContain("submitLabel?: string;");
    expect(shell).toContain("hint?: string;");
    expect(shell).toMatch(/\{onSubmit \? \( <div className="mt-auto sticky bottom-0/);
  });

  it("adds a leading slot and a header-actions slot before ✕", () => {
    expect(shell).toContain("leading?: ReactNode;");
    expect(shell).toContain("actions?: ReactNode;");
    expect(shell).toMatch(/\{actions\} <button type="button" onClick=\{onClose\} aria-label="Close"/);
  });

  it.each([
    "components/places/PlaceSheet.tsx",
    "components/places/GraduateSheet.tsx",
    "components/trip/NearbySaves.tsx",
  ])("%s still passes onSubmit and submitLabel", (p) => {
    const s = src(p);
    expect(s).toContain("<SheetShell");
    expect(s).toMatch(/submitLabel=/);
    expect(s).toMatch(/onSubmit=\{/);
  });
});

describe("PlaceView — the four blocks", () => {
  const view = src("components/places/PlaceView.tsx");

  it("is SheetShell with no footer: tile + core's meta as the kicker, Edit beside ✕", () => {
    const shell = view.slice(view.indexOf("<SheetShell"), view.indexOf("</SheetShell>"));
    expect(shell).toContain("kicker={placeScreenMeta(save)}");
    expect(shell).toContain("title={save.place.name}");
    expect(shell).toContain('leading={<CategoryTile type={save.type} size="md" />}');
    expect(shell).toMatch(/actions=\{ <button type="button" onClick=\{\(\) => setEdit\(savePlaceFormFromSaved\(save\)\)\} className="[^"]*text-rv-accent" > Edit <\/button> \}/);
    expect(shell.slice(0, shell.indexOf("{/* Go") === -1 ? shell.indexOf("{links") : 0)).not.toContain("onSubmit");
  });

  it("draws Go, Yours, What others say, then Delete, in that order", () => {
    const order = ['label="Go"', 'label="Yours"', 'label="What others say"', "Delete place"].map((s) =>
      view.indexOf(s),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("builds Go from navigateLinksForPlace, Call/Website only when details carry them, On the map → /map?place=", () => {
    expect(view).toContain("const links = navigateLinksForPlace(save.place);");
    expect(view).toMatch(/\{links && \( <Block label="Go">/);
    expect(view).toContain("{found?.nationalPhoneNumber && (");
    expect(view).toContain("placeTelUrl(found.nationalPhoneNumber)");
    expect(view).toContain("{found?.websiteUri && (");
    expect(view).toContain("href={`/map?place=${save.id}`}");
    expect(view).toContain("bg-rv-navy-soft");
  });

  it("writes the shelf and the stars through PATCH, then router.refresh()", () => {
    expect(view).toContain("onChange={(status) => status !== save.status && patch({ status })}");
    expect(view).toContain("onSet={(n) => patch({ rating: n === 0 ? null : n })}");
    const patch = view.slice(view.indexOf("const patch ="), view.indexOf("const submitEdit"));
    expect(patch).toContain("tripApi .updatePlace(save.id, p) .then(() => router.refresh())");
  });

  it("puts the G line and the shipped DrillRow under What others say", () => {
    expect(view).toContain("placeGoogleLine(d)");
    expect(view).toContain("Google Maps ↗");
    expect(view).toContain("G — checking…");
    expect(view).toContain("<DrillRow name={save.place.name} locality={save.region} type={save.type} />");
  });

  it("Edit opens the existing PlaceSheet in edit mode, sending core's editPlacePatch", () => {
    expect(view).toContain("setEdit(savePlaceFormFromSaved(save))");
    expect(view).toMatch(/<PlaceSheet form=\{edit\} mode="edit"/);
    expect(view).toContain("const p = editPlacePatch(edit);");
  });

  it("Delete is text-destructive and runs the shipped delete + Undo, then closes to /places", () => {
    expect(view).toMatch(/className="[^"]*text-destructive[^"]*"\s*> Delete place/);
    const remove = view.slice(view.indexOf("const remove ="), view.indexOf("const links ="));
    expect(remove).toContain("tripApi .deletePlace(save.id)");
    expect(remove).toContain("toast.success(`Deleted ${save.place.name}.`");
    expect(remove).toContain('label: "Undo"');
    expect(remove).toContain(".savePlace(savedPlaceToCreate(save))");
    expect(remove).toContain('router.push("/places");');
  });

  it("uses no raw hex", () => {
    expect(code(read("components/places/PlaceView.tsx"))).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code(read("components/places/PinOpenCard.tsx"))).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("every way in on the web", () => {
  it("PinOpenCard links Open to /places/[id]", () => {
    const card = src("components/places/PinOpenCard.tsx");
    expect(card).toMatch(/<Link href=\{`\/places\/\$\{save\.id\}`\}[^>]*text-rv-accent[^>]*> Open <\/Link>/);
  });

  it("/map: the selected saved place's rail card has Open → /places/[id]", () => {
    const map = src("components/map/MapOverview.tsx");
    const place = map.slice(map.indexOf("function SelectedPlace"), map.indexOf("function SelectedIdea"));
    expect(place).toMatch(/<Link href=\{`\/places\/\$\{pin\.id\}`\}[^>]*> Open <\/Link>/);
  });

  it("/map?place= preselects that pin, keyed on the param, with every filter on All", () => {
    const page = src("app/map/page.tsx");
    expect(page).toContain("searchParams: Promise<{ place?: string | string[] }>;");
    expect(page).toContain('focus={typeof place === "string" ? place : null}');
    const map = src("components/map/MapOverview.tsx");
    expect(map).toContain("useState<string | null>(focus)");
    expect(map).toMatch(
      /if \(focus !== focused\) \{ setFocused\(focus\); if \(focus\) \{ setPickedId\(focus\); setFilter\(\{ kind: "all" \}\); setCat\("All"\); \} \}/,
    );
  });

  it("the Places map panel shows the selected pin's card with Open", () => {
    const library = src("components/places/PlacesLibrary.tsx");
    const panel = /<aside[\s\S]*?<\/aside>/.exec(library)?.[0] ?? "";
    expect(panel).toContain("<PinOpenCard save={panelPick}");
    expect(library).toContain("lens.pins.some((p) => p.id === selectedId)");
  });

  it("the Journal map shows Open for a selected logged place that is in the library", () => {
    const jmap = src("components/trip/JournalMap.tsx");
    expect(jmap).toContain('picked?.kind === "idea" ? saveForJournalEntry(picked, saves) : null');
    expect(jmap).toContain("{open && <PinOpenCard save={open}");
  });

  it("a Journal entry in the library gets a › to /places/[id]; the row's own click is kept", () => {
    const lens = src("components/trip/JournalLens.tsx");
    const open = lens.slice(lens.indexOf("function EntryOpen"));
    expect(open).toContain("const save = saveForJournalEntry(entry, saves);");
    expect(open).toContain("if (!save) return null;");
    expect(open).toContain("href={`/places/${save.id}`}");
    expect(open).toContain("onClick={(ev) => ev.stopPropagation()}");
    expect(lens).toContain('onClick={e.kind === "idea" ? () => onSelect(e.id) : undefined}');
    expect(lens).toContain("<EntryOpen entry={e} saves={saves} />");
    expect(src("components/trip/TripPlanner.tsx")).toMatch(/<JournalLens[^>]*saves=\{savedPlaces\}/);
  });

  it("the library re-seeds from a fresh server render, so a Place view write shows under it", () => {
    const ws = src("components/places/PlacesWorkspace.tsx");
    expect(ws).toMatch(/if \(seed !== initialPlaces\) \{ setSeed\(initialPlaces\); setPlaces\(initialPlaces\); \}/);
  });
});
