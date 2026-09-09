import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { RV, categoryOf, dayKindColor } from "./tokens";

/**
 * `tokens.ts` mirrors `packages/ui/styles/entry.css` by hand. This test reads
 * the stylesheet and checks every mirrored value, so a palette change that
 * forgets the native side fails here rather than on someone's phone.
 *
 * Since issue #19 the stylesheet holds no `--color-rv-*: #hex` literals at all:
 * `@theme inline` maps every `--color-rv-*` to a raw `--rv-*` twin, and the raw
 * twins are declared twice — light on `:root`, dark on `.dark`. Reading the
 * `@theme inline` map would compare each native literal against the string
 * "var(--rv-…)", which nothing can equal, so the resolver is pointed at the raw
 * DARK half: night is the product default and the native app ships no toggle.
 */
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../../../ui/styles/entry.css"), "utf8");

/** The raw dark half — `.dark { --rv-*: <literal>; }`. */
const darkHalf = css.slice(css.indexOf(".dark {"), css.indexOf("}", css.indexOf(".dark {")));

function cssVar(name: string): string {
  const m = darkHalf.match(new RegExp(`--rv-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`--rv-${name} not found in the .dark half of entry.css`);
  return m[1]!.toLowerCase();
}

const MIRROR: Record<keyof typeof RV, string> = {
  navy: "navy",
  navyDeep: "navy-deep",
  navySoft: "navy-soft",
  green: "green",
  greenSoft: "green-soft",
  greenInk: "green-ink",
  accent: "accent",
  accentBright: "accent-bright",
  accentDeep: "accent-deep",
  accentSoft: "accent-soft",
  ink: "ink",
  inkMuted: "ink-muted",
  inkFaded: "ink-faded",
  inkSubtle: "ink-subtle",
  surface: "surface",
  surfaceAlt: "surface-alt",
  border: "border",
  borderSoft: "border-soft",
  borderHi: "border-hi",
  warning: "warning",
  warningSoft: "warning-soft",
  info: "info",
  infoSoft: "info-soft",
  travel: "travel",
  travelSoft: "travel-soft",
};

describe("RV tokens", () => {
  it("mirror entry.css exactly", () => {
    for (const [key, name] of Object.entries(MIRROR) as [keyof typeof RV, string][]) {
      expect({ [key]: RV[key] }).toEqual({ [key]: cssVar(name) });
    }
  });

  it("speak the category language", () => {
    expect(categoryOf("campground").cat).toBe("Stay");
    expect(categoryOf("lodging").color).toBe(RV.green);
    expect(categoryOf("dining").cat).toBe("Eat");
    expect(categoryOf("activity").cat).toBe("Do");
    expect(categoryOf("transport").cat).toBe("Travel");
    expect(categoryOf("other").cat).toBe("Other");
  });

  it("paint the rhythm like the web", () => {
    expect(dayKindColor("stay")).toBe(RV.green);
    expect(dayKindColor("drive")).toBe(RV.navy);
    expect(dayKindColor("empty")).toBe(RV.navySoft);
  });
});
