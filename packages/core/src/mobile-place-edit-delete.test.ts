import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RV } from "./theme/tokens";

/**
 * #197 · #194 — Edit and Delete on the phone Place screen, read as source.
 *
 * `apps/mobile` has no test runner (its package.json has only `typecheck`), so
 * this follows mobile-place-screen.test.ts: the copy is unit tested in
 * capture/place-screen.test.ts, the colour in theme/tokens.test.ts, the patch
 * and the re-save body in domain/place-form.test.ts (`editPlacePatch`,
 * `savedPlaceToCreate`). What is pinned HERE is that the phone wires them. That
 * the sheet, the toasts and Undo behave on a device is the walk's.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const screen = code(read("apps/mobile/app/place/[id].tsx"));
const store = code(read("apps/mobile/src/store.ts"));
const capture = code(read("apps/mobile/src/capture.ts"));
const ui = code(read("apps/mobile/src/ui.tsx"));
const host = code(read("apps/mobile/src/toast-host.tsx"));
const tabs = code(read("apps/mobile/app/(tabs)/_layout.tsx"));

describe("#194 · the destructive role", () => {
  it("exists in core RV and colours the Place screen's Delete, and nothing else on it", () => {
    expect(RV.destructive).toMatch(/^#[0-9a-f]{6}$/);
    expect(screen).toContain(">Delete place<");
    expect(screen).toContain("color: C.destructive");
    expect(screen.match(/C\.destructive/g)).toHaveLength(1);
  });

  it("is named in .design-sync/conventions.md as the colour of Delete and nothing else", () => {
    const conv = read(".design-sync/conventions.md");
    expect(conv).toContain("destructive is the colour of Delete and nothing else");
    expect(conv).toContain("C.destructive");
  });
});

describe("#194 · the store", () => {
  it("deleteSave removes the row, DELETEs it and refetches", () => {
    const fn = store.slice(store.indexOf("export async function deleteSave"));
    expect(fn).toContain("state.saves.filter((s) => s.id !== id)");
    expect(fn).toContain("await api.places.remove(id);");
    expect(fn.slice(0, fn.indexOf("\n}\n"))).toContain("await loadSaves();");
  });

  it("restoreSave re-posts savedPlaceToCreate(save) and returns the new row", () => {
    const fn = store.slice(store.indexOf("export async function restoreSave"));
    expect(fn).toContain("Promise<SavedPlace>");
    expect(fn).toContain("api.places.create(savedPlaceToCreate(save))");
    expect(fn).toContain("return created;");
  });
});

describe("#194 · the toast", () => {
  it("Toast takes an optional onView, drawn before Undo", () => {
    expect(ui).toContain("onView?: () => void;");
    expect(ui.indexOf(">View<")).toBeGreaterThan(-1);
    expect(ui.indexOf(">View<")).toBeLessThan(ui.indexOf(">Undo<"));
  });

  it("ToastTone carries removed and restored (and Delete's offline refusal)", () => {
    const tone = capture.slice(capture.indexOf("export type ToastTone"), capture.indexOf(";", capture.indexOf("export type ToastTone")));
    for (const t of ['"removed"', '"restored"', '"needs-signal"']) expect(tone).toContain(t);
    expect(capture).toContain('showToast(removedToast(name), "removed"');
    expect(capture).toContain('showToast(RESTORED_TOAST, "restored"');
    expect(capture).toContain('showToast(DELETE_OFFLINE_TOAST, "needs-signal")');
  });

  it("the host draws removed amber ⌫, restored green ↺ with View, and is mounted over the tabs AND the Place screen", () => {
    expect(host).toContain('removed: "⌫"');
    expect(host).toContain('restored: "↺"');
    expect(host).toContain('"needs-signal": "!"');
    expect(host).toMatch(/AMBER = new Set<ToastTone>\(\[[^\]]*"removed"[^\]]*"needs-signal"/);
    expect(host).toContain("onView={toast.onView}");
    expect(tabs).toContain("<CaptureToastHost />");
    expect(screen).toContain("<CaptureToastHost />");
  });
});

describe("#194 · the Place screen", () => {
  it("Edit seeds from savePlaceFormFromSaved and saves editPlacePatch through patchSave", () => {
    expect(screen).toContain(">Edit<");
    expect(screen).toContain("useState<SavePlaceForm>(() => savePlaceFormFromSaved(save))");
    expect(screen).toContain("const patch = editPlacePatch(form);");
    expect(screen).toContain("patchSave(save.id, patch)");
  });

  it("the sheet draws only what editPlacePatch sends — no Rating, no Shelf (vet HIGH)", () => {
    const sheet = screen.slice(screen.indexOf("function EditSheet"), screen.indexOf("function GoButton"));
    expect(sheet).toContain("<Label>Name</Label>");
    expect(sheet).toContain("<Label>Category</Label>");
    expect(sheet).toContain("<Label>Note</Label>");
    expect(sheet).not.toContain("<Label>Rating</Label>");
    expect(sheet).not.toContain("<Label>Shelf</Label>");
    expect(sheet).not.toContain("<Stars");
  });

  it("offline, Edit says why and does not save; Delete shows the refusal and stays", () => {
    expect(screen).toContain("{!online ? <Text style={styles.off}>{EDIT_OFFLINE_NOTICE}</Text> : null}");
    expect(screen).toContain("if (!online || !patch || busy) return;");
    expect(screen).toMatch(/if \(!online\) \{\s*announceDeleteNeedsSignal\(\);\s*return;\s*\}/);
  });

  it("online, Delete asks nothing: back, deleteSave, then Removed with Undo → restoreSave → View the new id", () => {
    const fn = screen.slice(screen.indexOf("const remove = "), screen.indexOf("return (", screen.indexOf("const remove = ")));
    expect(fn.indexOf("back();")).toBeLessThan(fn.indexOf("deleteSave(s.id)"));
    expect(fn).toContain("announceRemoved(s.place.name");
    expect(fn).toContain("restoreSave(s)");
    expect(fn).toContain("appRouter.push(`/place/${created.id}`)");
    expect(screen).not.toMatch(/Alert\.alert/);
  });

  it("names no raw colour", () => {
    expect(screen).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(host).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
