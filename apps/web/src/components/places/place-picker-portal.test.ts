import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * #80 · the picker's open list must ESCAPE its ancestors — asserted as source.
 *
 * The walk found the dropdown painted over by everything drawn after the
 * add-idea card: the rhythm strip, the legs, the Gantt's `sticky left-0 z-10`
 * row labels (packages/ui/src/Gantt.tsx:18). Inline, the list was an
 * `absolute inset-x-0 top-full z-10` child of the field's `relative` wrapper,
 * and a z-index only ever wins inside the stacking context it lives in — so the
 * fix is a portal to `document.body`, where there is no ancestor left to trap
 * it — except inside a Radix layer, where a body portal would be click-dead
 * under react-remove-scroll's `pointer-events: none` and would dismiss the
 * layer it was opened from. There the list stays inline, at z-30.
 *
 * Where it lands is arithmetic, and arithmetic is testable: `pickerListFrame`
 * is a pure function in @rv-trip/core with its own executed cases
 * (providers/place-picker.test.ts, "the open list's frame"). What is NOT
 * testable here is the paint — apps/web's vitest is `environment: "node"` with
 * no jsdom and no @testing-library/react, so there is no DOM to portal INTO and
 * no z-order to read back. So the structural claim is asserted the way
 * `navigate-control.test.ts` and `plan-undo.test.ts` already assert theirs: as
 * source text. It fails the moment someone puts the list back inline, which is
 * the regression that matters. The pixels stay render-required at the walk.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, "PlacePicker.tsx"), "utf8");

describe("PlacePicker's open list, as source", () => {
  it("renders through a portal to document.body", () => {
    expect(source).toContain('import { createPortal } from "react-dom"');
    expect(source).toContain("createPortal(");
    expect(source).toContain("document.body,");
  });

  it("keeps the inline list for Radix layers, clear of the z-10 it tied with", () => {
    // A modal sheet or dialog blocks the rest of the document with
    // `pointer-events: none` (react-remove-scroll), so a list portaled to the
    // BODY from inside one would be visible, dead to the mouse, and read as an
    // outside press that dismisses the layer under it. It stays inline there —
    // but never again at z-10, which is the level the Gantt's own sticky row
    // labels sit at. Matched against class attributes only: the docblock above
    // the component NAMES the old class, and explaining a bug is not shipping it.
    expect(source).toContain(`el.closest('[role="dialog"]')`);
    expect(source).toContain("absolute inset-x-0 top-full z-30");
    expect(source).not.toMatch(/className="[^"]*\bz-10\b/);
  });

  it("mounts ONE list body both ways — the rows never fork", () => {
    // Two copies of 60 lines of row JSX is how the portal path and the inline
    // path drift apart. There is one `listBody`, used by both branches.
    expect(source.match(/const listBody =/g)).toHaveLength(1);
    expect(source.match(/\{listBody\}/g)).toHaveLength(2);
    expect(source.match(/role="listbox"/g)).toHaveLength(1);
  });

  it("clears the sheets and dialogs it can open inside of", () => {
    // ui/sheet.tsx and ui/dialog.tsx both paint at z-50; a body portal at the
    // same level would be a DOM-order coin flip.
    expect(source).toContain("fixed z-[60]");
  });

  it("takes its frame from core's tested arithmetic, not its own", () => {
    expect(source).toContain("pickerListFrame(el.getBoundingClientRect(), window.innerHeight)");
    // The four numbers the frame is for, and nothing hand-rolled beside them.
    for (const key of [
      "left: mount.frame.left",
      "top: mount.frame.top",
      "width: mount.frame.width",
      "maxHeight: mount.frame.maxHeight",
    ]) {
      expect(source).toContain(key);
    }
  });

  it("follows the field it is welded to", () => {
    // Fixed coordinates go stale the moment anything scrolls. Capture phase,
    // because the scroller is usually an ancestor (a sheet's body, the page)
    // and a scroll event does not bubble from one.
    expect(source).toContain('window.addEventListener("scroll", measure, true)');
    expect(source).toContain('window.addEventListener("resize", measure)');
    expect(source).toContain("new ResizeObserver(measure)");
    // …and it lets go of the window when the list closes.
    expect(source).toContain('window.removeEventListener("scroll", measure, true)');
    expect(source).toContain("observer.disconnect()");
  });

  it("keeps the arrow-keyed highlight inside the capped list", () => {
    // `pickerListFrame` caps the list to the viewport and the listbox scrolls
    // inside that, so a highlight moved past the fold has to be brought back.
    expect(source).toContain('scrollIntoView({ block: "nearest" })');
  });

  it("never portals on the server, where there is no body to portal into", () => {
    // `mount` is null until the ResizeObserver's first callback, which only ever
    // runs in a browser, and null takes the inline branch — so the server render
    // is the markup this component has always emitted.
    expect(source).toContain("{open && mount?.portal");
  });
});
