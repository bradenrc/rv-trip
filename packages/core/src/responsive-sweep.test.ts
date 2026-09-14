import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * The 390px sweep (issue #45, item 2).
 *
 * Item 2 is layout: four grids that were pinned by an inline
 * `gridTemplateColumns` (an inline style takes no Tailwind variant, which is
 * why they break on a phone), the Places lens switch, the trip header, the
 * route rail, and the gantt's leg gutter — all rewritten mobile-first against
 * ONE `md` breakpoint, bare = phone, `md:` = desktop.
 *
 * None of it is logic that can be executed here: it is JSX and Tailwind class
 * strings, and `packages/core` has no DOM. So — exactly as `web-shell.test.ts`
 * (item 1), `mobile-map.test.ts` and `mobile-dev-loop.test.ts` already do — the
 * contract is asserted against the SOURCE TEXT of the real files.
 *
 * What this guards, criterion for criterion against the item's acceptance:
 *
 *   1. No inline `gridTemplateColumns` survives in app/page.tsx,
 *      PlacesLibrary.tsx or MapOverview.tsx, and no `max-[…]` variant survives
 *      ANYWHERE under apps/web/src (a recursive walk, not a spot check).
 *   2. Each converted layout's bare classes are the phone case and the `md:`
 *      variant carries the desktop columns.
 *   3. `ViewSwitch` gained one optional `fill` prop: full-width with visible
 *      labels below `md`, the icon-only 34px pill it is today at `md` and up —
 *      and PlacesLibrary's call site passes it.
 *   4. TripPlanner's h1 AND its InlineText className carry the same
 *      `text-[28px] md:text-[44px]` (or the inline editor jumps on focus).
 *   5. `Gantt.tsx`'s ONE shared gutter constant is sticky, opaque, and still
 *      the single constant all four row types consume — and the transparent
 *      `gap-4` those rows used to put between the gutter and the lane is gone,
 *      because a gap cannot be painted and bars scroll visibly through it.
 *
 * What it cannot assert: that any of it renders. Whether the sticky gutter
 * actually occludes a bar mid-scroll is a pointer/overflow question — the
 * walk's job, not this file's.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");

/** Source with `//` and block comments stripped — a claim about code must not
 * be satisfied by a comment that merely mentions the thing. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Collapse whitespace so a JSX attribute that hard-wraps still matches. */
const flat = (s: string) => s.replace(/\s+/g, " ");

const HOME = "apps/web/src/app/page.tsx";
const PLACES = "apps/web/src/components/places/PlacesLibrary.tsx";
const MAPOVERVIEW = "apps/web/src/components/map/MapOverview.tsx";
const PLANNER = "apps/web/src/components/trip/TripPlanner.tsx";
const ROUTEVIEW = "apps/web/src/components/trip/RouteView.tsx";
const GANTT = "packages/ui/src/Gantt.tsx";
const TIMELINE = "apps/web/src/components/trip/Timeline.tsx";
const SWITCH = "packages/ui/src/Places.tsx";

const home = flat(code(read(HOME)));
const places = flat(code(read(PLACES)));
const mapOverview = flat(code(read(MAPOVERVIEW)));
const planner = flat(code(read(PLANNER)));
const routeView = flat(code(read(ROUTEVIEW)));
const gantt = code(read(GANTT));
const ganttFlat = flat(gantt);
const timeline = flat(code(read(TIMELINE)));
const places_ds = code(read(SWITCH));

/** The literal `className="…"` string that contains `needle`. */
function className(src: string, needle: string): string {
  const hit = src
    .split('className="')
    .slice(1)
    .map((p) => p.slice(0, p.indexOf('"')))
    .find((c) => c.includes(needle));
  expect(hit, `no className contains ${needle}`).toBeTruthy();
  return hit as string;
}

/** Every `.ts`/`.tsx` under a directory, recursively. */
function sources(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(join(REPO, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) sources(rel, acc);
    else if (/\.tsx?$/.test(e.name)) acc.push(rel);
  }
  return acc;
}

describe("the inline grid styles are gone", () => {
  it.each([
    ["app/page.tsx", HOME, home],
    ["PlacesLibrary.tsx", PLACES, places],
    ["MapOverview.tsx", MAPOVERVIEW, mapOverview],
  ])("%s has no inline gridTemplateColumns", (_name, _path, src) => {
    expect(src).not.toContain("gridTemplateColumns");
  });

  it("no max-[…] variant is left anywhere under apps/web/src", () => {
    const offenders = sources("apps/web/src").filter((f) => code(read(f)).includes("max-["));
    expect(offenders).toEqual([]);
  });
});

describe("the converted grids are phone-first with md: carrying the desktop columns", () => {
  it("home: the Upcoming shelf is one column, auto-fill 320 at md", () => {
    expect(home).toContain(
      'className="grid grid-cols-1 gap-4 md:grid-cols-[repeat(auto-fill,minmax(320px,1fr))]"',
    );
  });

  it("home: the Traveled shelf is one column, auto-fill 340 at md", () => {
    expect(home).toContain(
      'className="grid grid-cols-1 gap-4 md:grid-cols-[repeat(auto-fill,minmax(340px,1fr))]"',
    );
  });

  it("places: the card shelf is one column, auto-fill 340 at md", () => {
    expect(places).toContain(
      'className="grid grid-cols-1 gap-4 md:grid-cols-[repeat(auto-fill,minmax(340px,1fr))]"',
    );
  });

  it("places: the map lens stacks below md and is 1fr/360px at md", () => {
    expect(places).toContain(
      'className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-[1fr_360px]"',
    );
  });

  it("map overview: the same pair, and its max-[980px] line is gone", () => {
    expect(mapOverview).toContain('className="grid grid-cols-1 items-stretch md:grid-cols-[1fr_360px]"');
    expect(mapOverview).not.toContain("max-[980px]");
  });
});

describe("ViewSwitch gains one optional `fill` prop", () => {
  const ds = flat(places_ds);

  it("declares fill?: boolean", () => {
    expect(ds).toContain("fill?: boolean");
  });

  it("the root stretches only when fill is passed", () => {
    expect(ds).toContain('fill ? "flex w-full md:inline-flex md:w-auto" : "inline-flex"');
  });

  it("each button is flex-1 below md and the shipped 34px pill at md", () => {
    expect(ds).toContain('fill ? "flex-1 gap-1.5 md:flex-none" : ""');
    expect(ds).toContain("h-[30px] w-[34px]");
  });

  it("the label renders beside the icon inside an md:hidden span", () => {
    expect(ds).toMatch(/fill && \(\s*<span className=\{`[^`]*md:hidden/);
    expect(ds).toContain("{o.label}");
  });

  it("PlacesLibrary's call site passes fill", () => {
    const call = places.slice(places.indexOf("<ViewSwitch"));
    expect(call.slice(0, call.indexOf("/>"))).toContain("fill");
  });
});

describe("the trip header clamps to the phone", () => {
  it("the planner gutter is px-4 py-6 below md, the shipped px-6 py-8 at md", () => {
    expect(planner).toContain('className="mx-auto max-w-[1240px] px-4 py-6 md:px-6 md:py-8"');
  });

  it("the h1 and the InlineText className carry the SAME clamp", () => {
    // Both, or the inline editor jumps a size the moment it takes focus.
    expect(planner.match(/text-\[28px\]/g)?.length).toBe(2);
    expect(planner.match(/md:text-\[44px\]/g)?.length).toBe(2);
    expect(planner).not.toMatch(/(?<!md:)text-\[44px\]/);
  });

  it("the lens / costs / Add stop cluster is full-width and wraps below md", () => {
    const cluster = className(planner, "md:w-auto");
    for (const cls of ["flex", "w-full", "flex-wrap", "items-center", "gap-3", "md:w-auto"]) {
      expect(cluster, `the control cluster is missing ${cls}`).toContain(cls);
    }
    const lens = className(planner, "rounded-rv-pill border border-rv-border");
    expect(lens).toContain("flex-1");
    expect(lens).toContain("md:flex-none");
    const addStop = className(planner, "bg-rv-accent-deep");
    expect(addStop).toContain("ml-auto");
    expect(addStop).toContain("md:ml-0");
  });

  it("the route rail is full-bleed below md and the shipped 260px at md", () => {
    expect(routeView).toContain('className="w-full md:w-[260px] md:flex-none"');
  });
});

describe("the gantt's leg column freezes", () => {
  it("there is exactly ONE gutter constant", () => {
    expect(gantt.match(/^const gutter =/gm)?.length).toBe(1);
  });

  it("it is sticky, opaque, and mobile-first 92 -> 120", () => {
    const decl = ganttFlat.slice(ganttFlat.indexOf("const gutter ="), ganttFlat.indexOf("const kicker"));
    for (const cls of [
      "sticky",
      "left-0",
      "z-10",
      "w-[92px]",
      "flex-none",
      "border-r",
      "border-rv-border-soft",
      "bg-rv-surface",
      "pr-2",
      "md:w-[120px]",
    ]) {
      expect(decl, `gutter is missing ${cls}`).toContain(cls);
    }
  });

  it("it stretches to the row height, so there is no unpainted band", () => {
    const decl = ganttFlat.slice(ganttFlat.indexOf("const gutter ="), ganttFlat.indexOf("const kicker"));
    expect(decl).toContain("self-stretch");
  });

  it("all four row types consume that one constant", () => {
    expect(ganttFlat.match(/\{gutter\}/g)?.length).toBe(4);
  });

  it("no transparent gap is left between the gutter and the lane", () => {
    // A `gap-4` between a sticky gutter and the lane is 16px of nothing: the
    // bars scroll visibly through it. The wireframe draws the two flush.
    expect(gantt).not.toContain("gap-4");
  });

  it("everything else about the gantt is as shipped", () => {
    expect(timeline).toContain("Math.max(820, days * 30)");
    expect(timeline).toContain("const ROW_HEIGHT = 78");
    expect(ganttFlat).toContain("compact = false");
  });

  it("Timeline carries the phone-only swipe hint", () => {
    expect(timeline).toContain("← swipe the calendar · the leg column stays put →");
    expect(timeline).toContain("font-mono text-[10px] text-rv-ink-faded md:hidden");
  });
});
