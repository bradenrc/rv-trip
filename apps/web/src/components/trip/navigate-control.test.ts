import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * The split Navigate control (docs/design/43 §4), asserted where it CAN be.
 *
 * The acceptance asks for a RouteView render test. There is no DOM in this
 * repo to render it in: apps/web's vitest is `environment: "node"`, collects
 * only `.test.ts`, and the workspace ships no jsdom, no happy-dom, no
 * @testing-library/react and no @vitejs/plugin-react (the vet's HIGH). Adding
 * four dependencies to assert three class names is not this item's scope, so
 * the split is asserted in two honest halves instead:
 *
 *  · the COPY and the ORDER — the parts that are logic — are pure functions in
 *    @rv-trip/core and executed by packages/core's suite
 *    (`navigationOptions` / `navigationCaption` in planner.test.ts);
 *  · the CLASSES are asserted here, as source text, in the same idiom
 *    packages/core/src/theme/nightfall-tokens.test.ts already uses for the
 *    token call sites it cannot render.
 *
 * What neither half can do is prove a radix portal opens inside the route rail.
 * That is render-required at the walk.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, "RouteView.tsx"), "utf8");

describe("RouteView's Navigate control, as source", () => {
  it("is ONE control, used by both drive renderings", () => {
    expect(source.match(/function NavigateButton\(/g)).toHaveLength(1);
    // The clean one-liner and the restricted card — the two renderings that
    // draw a drive. There is no third call site and no fourth state.
    expect(source.match(/<NavigateButton drive=\{drive\}/g)).toHaveLength(2);
    expect(source).not.toContain("NavigateButton href=");
  });

  it("keeps the 32px floor on every half of the split", () => {
    // Pressed at a fuel stop with the engine running: the pill, the body and
    // the caret all carry min-h-8, so no half of the control can shrink under
    // the touch target.
    const control = source.slice(source.indexOf("const NAV_PILL"));
    expect(control.match(/min-h-8/g)?.length).toBeGreaterThanOrEqual(3);
    expect(control).toContain("bg-rv-accent-deep text-rv-accent-ink");
  });

  it("composes the shipped menu rather than restyling one", () => {
    // MENU_SURFACE / MENU_ITEM are the row menu's own classes (row-menu.tsx),
    // which is what keeps this menu the same object as the other three.
    expect(source).toMatch(/DropdownMenuContent align="end" className=\{MENU_SURFACE\}/);
    expect(source).toContain("${MENU_ITEM} items-start");
  });

  it("paints the caption green on 'checked' and amber otherwise", () => {
    const caption = source.slice(
      source.indexOf("function DriveCaption"),
      source.indexOf("const NAV_PILL"),
    );
    expect(caption).toContain('caption.tone === "checked" ? "text-rv-green" : "text-rv-warning"');
    // The strings themselves come from core — one place, and a place a runner
    // can reach. The component must not carry copy of its own.
    expect(caption).toContain("{caption.text}");
    expect(caption).not.toContain("RV-safe");
  });

  it("carries no raw colour and no hand-written navigation copy", () => {
    const control = source.slice(source.indexOf("function DriveCaption"));
    expect(control).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(control).not.toContain("WeGo");
    expect(control).not.toContain("Google Maps");
  });
});
