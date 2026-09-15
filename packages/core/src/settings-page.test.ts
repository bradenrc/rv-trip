import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Settings, units honored, People & groups retired (issue #45, item 5 · #38).
 *
 * The executable half of item 5 is `src/domain/units.ts` — `convertMiles` and
 * `distanceUnitLabel`, covered in `src/domain/units.test.ts` where they live,
 * plus `arcLabel` (`planner/map-arcs.test.ts`) and the units-aware `driveLabel`
 * (`providers/route-format.test.ts`). All three run as CODE.
 *
 * What is left is wiring — a server component, a "use client" form, a prop
 * threaded through four trees, a deleted route and a config redirect — and,
 * exactly as `web-shell.test.ts`, `pwa.test.ts` and `prefs-account.test.ts`
 * already do for `apps/web`, it is asserted against the SOURCE TEXT of the real
 * files. That is the honest limit of this file: it proves the seam is wired as
 * designed, not that a browser rendered it. **The rendered page, the switch's
 * pointer behaviour and the redirect actually answering 308 are the walk's
 * job.**
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");

/** Source with `//` and block comments stripped — a claim about code must not
 * be satisfied by a comment that merely mentions the thing. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
/** Collapse whitespace so a hard-wrapped call still matches. */
const flat = (s: string) => s.replace(/\s+/g, " ");

const settingsPage = read("apps/web/src/app/settings/page.tsx");
const settingsForm = read("apps/web/src/components/settings/SettingsForm.tsx");
const prefSwitch = read("apps/web/src/components/ui/pref-switch.tsx");
const tripPlanner = read("apps/web/src/components/trip/TripPlanner.tsx");
const routeView = read("apps/web/src/components/trip/RouteView.tsx");
const tripCard = read("apps/web/src/components/dashboard/TripCard.tsx");
const pins = read("apps/web/src/components/map/pins.ts");
const rigForm = read("apps/web/src/components/rig/RigForm.tsx");
const nextConfig = read("apps/web/next.config.ts");
const libUnits = read("apps/web/src/lib/units.ts");
const dsPlaces = read("packages/ui/src/Places.tsx");

/** Every .ts/.tsx file under apps/web/src. */
function webSources(): string[] {
  const root = join(REPO, "apps/web/src");
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((p) => p.endsWith(".ts") || p.endsWith(".tsx"))
    .map((p) => join("apps/web/src", p));
}

describe("/settings is a real page", () => {
  it("no longer imports StubPage", () => {
    expect(settingsPage).not.toContain("StubPage");
  });

  it("is a server component — no 'use client', and force-dynamic like its siblings", () => {
    expect(code(settingsPage)).not.toContain('"use client"');
    expect(settingsPage).toContain('export const dynamic = "force-dynamic"');
    expect(settingsPage).toContain("export default async function SettingsPage()");
  });

  it("reads the owner-scoped prefs row and hands it to the client form", () => {
    expect(flat(code(settingsPage))).toContain("getPrefsByOwner(await getOwner())");
    expect(flat(code(settingsPage))).toContain("<SettingsForm prefs={prefs}");
  });

  it("reads the household on the SAME seam, and hands it down as props (#77)", () => {
    // docs/design/81 dev note 3: household + members + the live invite are read
    // on the server, exactly where `prefs` is, so the card fetches nothing on
    // mount. A client-side read here would put a spinner on a settings page.
    expect(flat(code(settingsPage))).toContain("getHouseholdOverview(await getOwner())");
    expect(flat(code(settingsPage))).toContain("household={{");
    expect(code(settingsPage)).not.toContain('"use client"');
  });

  it("renders inside the one page shell, not a second gutter", () => {
    expect(settingsPage).toContain('from "@/components/nav/PageShell"');
    expect(flat(code(settingsPage))).toContain("<PageShell>");
    expect(code(settingsPage)).not.toContain("max-w-[1120px]");
  });

  it("hands the form the row itself, so the unresolved first render is the account's answer", () => {
    expect(flat(code(settingsForm))).toContain("storedUnits ?? unitsFromPrefs(prefs)");
    expect(flat(code(settingsForm))).toContain("storedStyle ?? styleFromPrefs(prefs)");
  });
});

describe("the form — three groups, four controls", () => {
  it("is a client component", () => {
    expect(settingsForm.startsWith('"use client"')).toBe(true);
  });

  it("draws the three group headings the design names", () => {
    for (const group of ["Appearance", "Maps &amp; planning", "Account"]) {
      expect(settingsForm).toContain(`<GroupKicker>${group}</GroupKicker>`);
    }
  });

  it("labels all four rows, with the design's helper copy", () => {
    expect(settingsForm).toContain('label="Theme"');
    expect(settingsForm).toContain(
      "Dark is the default. The masthead toggle writes the same preference.",
    );
    expect(settingsForm).toContain('label="Units"');
    expect(settingsForm).toContain("Rig dimensions and drive distances. Always stored metric.");
    expect(settingsForm).toContain('label="Default map style"');
    expect(settingsForm).toContain("What every map opens with. Night is the product default.");
    expect(settingsForm).toContain("Track costs");
    expect(settingsForm).toContain("Show reservation costs and the per-leg rollup.");
  });

  it("uses the DS SegmentedControl for the three vocabularies, and the lifted switch for the fourth", () => {
    expect(settingsForm).toContain('from "@rv-trip/ui"');
    expect(code(settingsForm)).toContain("<SegmentedControl<Theme>");
    expect(code(settingsForm)).toContain("<SegmentedControl<Units>");
    expect(code(settingsForm)).toContain("<SegmentedControl<StyleMode>");
    expect(code(settingsForm)).toContain("<PrefSwitch");
  });

  it("takes the map-style options from MapMount, never a second copy of the list", () => {
    expect(settingsForm).toContain("STYLE_SEGMENTS");
    expect(code(settingsForm)).not.toContain('label: "Night"');
    expect(flat(code(settingsForm))).toContain("options={STYLE_SEGMENTS}");
  });

  it("writes through the SAME pref hooks every other consumer uses — one store, not two", () => {
    expect(settingsForm).toContain('from "@/lib/pref"');
    expect(code(settingsForm)).toContain("useStringPref(UNITS_PREF_KEY, isUnits, DEFAULT_UNITS)");
    expect(code(settingsForm)).toContain(
      "useStringPref(STYLE_PREF_KEY, isStyleMode, DEFAULT_STYLE_MODE)",
    );
    expect(code(settingsForm)).toContain('useBooleanPref("rv-track-costs")');
    // The theme is the one preference painted as a class on <html>, so it goes
    // through its own hook rather than being toggled here by hand.
    expect(code(settingsForm)).toContain("useTheme()");
    expect(code(settingsForm)).not.toContain("document.documentElement");
  });

  it("invalidates the router when units changes — the four consumers read it on the SERVER", () => {
    expect(flat(code(settingsForm))).toContain("setUnits(u); router.refresh();");
  });

  it("puts <Account/> in the third card rather than re-drawing the account control", () => {
    expect(settingsForm).toContain('from "@/components/nav/Account"');
    expect(code(settingsForm)).toContain("<Account />");
    expect(code(settingsForm)).not.toContain("dev-user");
  });

  it("spends only rv-* tokens — no raw hex anywhere on the page", () => {
    expect(code(settingsForm)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("one switch, imported by both screens", () => {
  it("keeps the shipped metrics — 38x22, rv-green on, rv-border-hi off, an 18px knob", () => {
    expect(flat(prefSwitch)).toContain("h-[22px] w-[38px]");
    expect(flat(prefSwitch)).toContain("bg-rv-green");
    expect(flat(prefSwitch)).toContain("bg-rv-border-hi");
    expect(flat(prefSwitch)).toContain("size-[18px]");
    expect(flat(prefSwitch)).toContain("left: checked ? 18 : 2");
    expect(prefSwitch).toContain('role="switch"');
  });

  it("renders the label only when one is given — the Settings row draws its own", () => {
    expect(flat(code(prefSwitch))).toContain("{label && (");
    expect(flat(code(prefSwitch))).toContain("aria-label={label ? undefined : ariaLabel}");
  });

  it("is TripPlanner's only switch — the private CostSwitch is gone", () => {
    expect(tripPlanner).toContain('from "@/components/ui/pref-switch"');
    expect(tripPlanner).not.toContain("function CostSwitch");
    expect(tripPlanner).not.toContain("<CostSwitch");
    expect(flat(code(tripPlanner))).toContain(
      '<PrefSwitch checked={costTracking} onChange={changeCostTracking} label="Track costs" />',
    );
  });
});

describe("units is resolved on the server and passed down", () => {
  const SERVER_PAGES = [
    "apps/web/src/app/page.tsx",
    "apps/web/src/app/trips/[id]/page.tsx",
    "apps/web/src/app/map/page.tsx",
    "apps/web/src/app/rig/page.tsx",
  ];

  it("every one of the four roots reads the prefs row and narrows it once", () => {
    for (const p of SERVER_PAGES) {
      const src = code(read(p));
      expect(src, p).toContain("getPrefsByOwner");
      expect(src, p).toContain("unitsFromPrefs(");
      expect(src, p).not.toContain('"use client"');
    }
  });

  it("hands it down as a plain prop, so no display component becomes a client one", () => {
    expect(flat(code(read("apps/web/src/app/page.tsx")))).toContain("units={units}");
    expect(flat(code(read("apps/web/src/app/trips/[id]/page.tsx")))).toContain("units={units}");
    expect(flat(code(read("apps/web/src/app/map/page.tsx")))).toContain("units={units}");
    expect(flat(code(read("apps/web/src/app/rig/page.tsx")))).toContain(
      "units={unitsFromPrefs(prefs)}",
    );
    // TripCard is itself a server component: a prop, never a hook.
    expect(code(tripCard)).not.toContain('"use client"');
  });

  it("narrows null and a stale value to the product default", () => {
    expect(flat(code(libUnits))).toContain(
      "return stored && isUnits(stored) ? stored : DEFAULT_UNITS;",
    );
    // Server-importable: no hook, and therefore no "use client" boundary.
    expect(code(libUnits)).not.toContain('"use client"');
    expect(code(libUnits)).not.toContain("useStringPref");
    expect(libUnits).toContain('export const UNITS_PREF_KEY = "rv-units"');
  });
});

describe("the four display sites take label and value from core", () => {
  it("the dashboard card", () => {
    expect(flat(code(tripCard))).toContain(
      "{convertMiles(trip.miles, units)} {distanceUnitLabel(units)}",
    );
  });

  it("the Route rail's 34px hero — two separately-styled spans, still", () => {
    expect(flat(code(routeView))).toContain(
      'summary.driveMiles > 0 ? convertMiles(summary.driveMiles, units) : "—"',
    );
    expect(flat(code(routeView))).toContain("{distanceUnitLabel(units)}");
    expect(flat(code(routeView))).toContain("text-[34px]");
    expect(flat(code(routeView))).toContain("text-[15px]");
  });

  it("the map's arc labels, through core's shared arcLabel", () => {
    expect(flat(code(pins))).toContain("label: arcLabel(arc, units)");
  });

  it("the rig form — metres and kilograms in metric, and metric converts nothing", () => {
    expect(code(rigForm)).toContain("units === \"metric\"");
    expect(flat(code(rigForm))).toContain('label={`${label} in metres`}');
    expect(flat(code(rigForm))).toContain('{metric ? "kg" : "lb"}');
    // The stored value goes straight in and straight back out: no rounding
    // on the metric path, or 3.5052 m would drift on every save.
    expect(flat(code(rigForm))).toContain('if (units === "metric") return { ...BLANK, m: String(meters) };');
    expect(flat(code(rigForm))).toContain('return units === "metric" ? n : poundsToKilograms(n);');
  });

  it("leaves no hard-coded mi label anywhere under apps/web/src", () => {
    const offenders: string[] = [];
    for (const file of webSources()) {
      if (file.includes(".test.")) continue;
      const src = code(read(file));
      if (/(["'`>])\s*mi\s*(["'`<])/.test(src) || /\}\s*mi\b/.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe("the DS segmented control composes a label-only segment", () => {
  it("makes Icon optional and renders it only when given", () => {
    expect(flat(dsPlaces)).toContain("Icon?: LucideIcon;");
    expect(flat(dsPlaces)).toContain(
      '{o.Icon && <o.Icon className={`size-3.5 ${on ? activeIcon : "text-rv-ink-subtle"}`} />}',
    );
  });

  it("and the Units segments name none — the design pins no glyph for them", () => {
    expect(flat(code(settingsForm))).toContain(
      '{ value: "imperial", label: "Imperial" }, { value: "metric", label: "Metric" }',
    );
  });
});

describe("People & groups is retired", () => {
  it("the page is deleted", () => {
    expect(existsSync(join(REPO, "apps/web/src/app/settings/people/page.tsx"))).toBe(false);
    expect(existsSync(join(REPO, "apps/web/src/app/settings/people"))).toBe(false);
  });

  it("the route redirects to /settings from next.config, before any React tree renders", () => {
    expect(flat(code(nextConfig))).toContain("async redirects()");
    expect(flat(code(nextConfig))).toContain(
      '{ source: "/settings/people", destination: "/settings", permanent: true }',
    );
  });

  it("the stub's blurb and its sharing copy are gone from the tree", () => {
    for (const file of webSources()) {
      const src = read(file);
      expect(src, file).not.toContain("People & groups");
      expect(src, file).not.toContain("fishing buddies");
      expect(src, file).not.toContain("Settings › People");
    }
  });
});
