import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { RV, RV_LIGHT_ISLAND, categoryOf, dayKindColor } from "./tokens";

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

/** The light island — `.rv-light-island { --rv-*: <literal>; }` (issue #123). */
const islandHalf = css.slice(
  css.indexOf(".rv-light-island {"),
  css.indexOf("}", css.indexOf(".rv-light-island {")),
);

function varIn(block: string, where: string, name: string): string {
  const m = block.match(new RegExp(`--rv-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`--rv-${name} not found in the ${where} of entry.css`);
  return m[1]!.toLowerCase();
}

function cssVar(name: string): string {
  return varIn(darkHalf, ".dark half", name);
}

/** OKLCH → sRGB hex (Björn Ottosson's matrices; out-of-gamut channels clamp,
 * as a browser does). React Native reads no oklch, so RV holds this hex. */
function oklchToHex(L: number, C: number, h: number): string {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  return (
    "#" +
    lin
      .map((x) => Math.round(Math.min(1, Math.max(0, gamma(x))) * 255))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}

/** `destructive` is not an `--rv-*` token: it mirrors shadcn's `--destructive`
 * in apps/web's globals.css and is checked on its own below. */
const MIRROR: Record<Exclude<keyof typeof RV, "destructive">, string> = {
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
    for (const [key, name] of Object.entries(MIRROR) as [Exclude<keyof typeof RV, "destructive">, string][]) {
      expect({ [key]: RV[key] }).toEqual({ [key]: cssVar(name) });
    }
  });

  it("mirror the .rv-light-island half for foreign marks", () => {
    const island: Record<keyof typeof RV_LIGHT_ISLAND, string> = {
      surface: "surface",
      ink: "ink",
      borderHi: "border-hi",
    };
    for (const [key, name] of Object.entries(island) as [
      keyof typeof RV_LIGHT_ISLAND,
      string,
    ][]) {
      expect({ [key]: RV_LIGHT_ISLAND[key] }).toEqual({
        [key]: varIn(islandHalf, ".rv-light-island block", name),
      });
    }
  });

  it("mirror globals.css's dark --destructive as hex (#197 · q3 B)", () => {
    const web = readFileSync(join(here, "../../../../apps/web/src/app/globals.css"), "utf8");
    const dark = web.slice(web.indexOf(".dark {"), web.indexOf("}", web.indexOf(".dark {")));
    const m = dark.match(/--destructive:\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/);
    if (!m) throw new Error("--destructive not found in globals.css's .dark block");
    expect(oklchToHex(Number(m[1]), Number(m[2]), Number(m[3]))).toBe(RV.destructive);
    // Tailwind v4's red-400, which is what shadcn's dark destructive is.
    expect(RV.destructive).toBe("#ff6467");
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
    expect(dayKindColor("travel")).toBe(RV.navy);
    expect(dayKindColor("empty")).toBe(RV.navySoft);
  });
});
