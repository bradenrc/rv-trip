import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * The web shell's navigation contract (issue #45, item 1).
 *
 * Item 1 is layout: a desktop masthead row, a phone tab bar and one page
 * gutter (`PageShell`) in place of six verbatim copies. #173 i3 (#171 · Q1 C ·
 * Q2 B) split the one `LINKS` array in two: the desktop row is Trips · Places ·
 * Map, and the phone bar is its own `TABS`, the phone's five. None of it is logic that can be executed here — it is JSX
 * and Tailwind class strings, and `apps/web` has no DOM test environment. So,
 * exactly as `mobile-map.test.ts` / `mobile-dev-loop.test.ts` do for the phone's
 * un-mountable native renderer, the contract is asserted against the SOURCE
 * TEXT of the real files.
 *
 * What this guards, criterion for criterion against the item's acceptance:
 *
 *   1. Two lists, each declared ONCE and mapped ONCE: `LINKS` (Trips at
 *      /trips · Places · Map) and `TABS` (Trips · Places · Capture · Map ·
 *      You). /settings and /rig are reached through You, not the bar.
 *   2. The masthead keeps its `dark sticky` island and 62px height, takes
 *      `px-4 md:px-7`, and its link row is behind `hidden … md:flex`.
 *   3. The phone tab bar: fixed to the bottom inside the same `dark` island,
 *      `md:hidden`, five 56px `flex-1` targets, `pb-[env(safe-area-inset-bottom)]`,
 *      the Nav.tsx:38-40 active/inactive token pairing, and NO pill.
 *   4. Issue #19's theme toggle is byte-for-byte what it was: a CSS-driven
 *      glyph, not React state. Since #173 · Q2 B it, + Capture and <Account/>
 *      sit in one `hidden md:inline-flex` cluster: below md the masthead is
 *      the mark alone.
 *   5. `PageShell` is the one page gutter, and no copy of the old literal
 *      survives anywhere under `apps/web/src`.
 *
 * What it cannot assert: that any of it renders. Whether `env(safe-area-inset-bottom)`
 * resolves to a real inset, and whether the fixed bar actually clears the page's
 * last row, are device questions — the walk's job, not this file's.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");

const nav = read("apps/web/src/components/nav/Nav.tsx");
const shell = read("apps/web/src/components/nav/PageShell.tsx");

/** Source with `//` and block comments stripped — a claim about code must not
 * be satisfied by a comment that merely mentions the thing. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Collapse whitespace so a JSX attribute that hard-wraps still matches. */
const flat = (s: string) => s.replace(/\s+/g, " ");

const navCode = code(nav);
const navFlat = flat(navCode);
const shellFlat = flat(code(shell));

/** The `<nav>` element whose className contains `needle`, flattened. */
function navElement(needle: string): string {
  const parts = navFlat.split("<nav ").slice(1);
  const hit = parts.find((p) => p.slice(0, p.indexOf(">")).includes(needle));
  expect(hit, `no <nav> whose opening tag mentions ${needle}`).toBeTruthy();
  return hit!;
}

/** The six page-gutter call sites the item replaces. */
const GUTTER_SITES = [
  "apps/web/src/app/trips/page.tsx",
  "apps/web/src/app/places/page.tsx",
  "apps/web/src/app/map/page.tsx",
  "apps/web/src/app/trips/new/page.tsx",
  "apps/web/src/components/rig/RigForm.tsx",
  "apps/web/src/components/nav/StubPage.tsx",
];

/** Every .ts/.tsx file under apps/web/src. */
function webSources(): string[] {
  const root = join(REPO, "apps/web/src");
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((p) => p.endsWith(".ts") || p.endsWith(".tsx"))
    .map((p) => join("apps/web/src", p));
}

/** The hrefs of `const <name> … = [ … ];`, in order. */
function hrefsOf(name: string): string[] {
  const body = navFlat.slice(navFlat.indexOf(`const ${name}`));
  return [...body.slice(0, body.indexOf("];")).matchAll(/href: "([^"]*)"/g)].map((m) => m[1]!);
}

describe("two lists, each declared and rendered once (#173 · Q1 C · Q2 B)", () => {
  it("the desktop row is Trips at /trips, Places and Map", () => {
    expect(hrefsOf("LINKS")).toEqual(["/trips", "/places", "/map"]);
  });

  it("the phone bar is the phone's five: Capture goes to /places, You to /you", () => {
    expect(hrefsOf("TABS")).toEqual(["/trips", "/places", "/places", "/map", "/you"]);
  });

  it("reaches /settings and /rig through You, which is lit on both", () => {
    expect(navFlat).toContain('["/you", "/rig", "/settings"].some((r) => p.startsWith(r))');
    expect(hrefsOf("LINKS")).not.toContain("/settings");
    expect(hrefsOf("LINKS")).not.toContain("/rig");
  });

  it("declares each array once and renders each once", () => {
    expect(navCode.match(/const LINKS/g)).toHaveLength(1);
    expect(navCode.match(/const TABS/g)).toHaveLength(1);
    expect(navCode.match(/LINKS\.map\(/g)).toHaveLength(1);
    expect(navCode.match(/TABS\.map\(/g)).toHaveLength(1);
  });
});

describe("the masthead — unchanged at md, stripped to chrome below it", () => {
  const masthead = navElement("sticky top-0");

  it("keeps its dark island, its sticky 62px height and its z-order", () => {
    for (const cls of ["dark", "sticky", "top-0", "z-20", "h-[62px]", "bg-rv-surface"]) {
      expect(masthead.slice(0, masthead.indexOf(">"))).toContain(cls);
    }
  });

  it("takes the phone gutter, with the shipped one behind md", () => {
    expect(masthead.slice(0, masthead.indexOf(">"))).toContain("px-4 md:px-7");
  });

  it("puts the link row behind hidden md:flex", () => {
    expect(masthead).toMatch(/className="[^"]*\bhidden\b[^"]*\bmd:flex\b[^"]*"/);
  });
});

describe("the phone tab bar", () => {
  const bar = navElement("fixed inset-x-0 bottom-0");
  const open = bar.slice(0, bar.indexOf(">"));

  it("is fixed to the bottom, inside the same dark island, hidden at md and up", () => {
    for (const cls of [
      "dark",
      "fixed",
      "inset-x-0",
      "bottom-0",
      "z-20",
      "flex",
      "border-t",
      "border-rv-border",
      "bg-rv-surface",
      "pb-[env(safe-area-inset-bottom)]",
      "md:hidden",
    ]) {
      expect(open, `tab bar is missing ${cls}`).toContain(cls);
    }
  });

  it("renders five full-width 56px column targets", () => {
    for (const cls of [
      "flex-1",
      "flex-col",
      "items-center",
      "justify-center",
      "gap-[3px]",
      "h-[56px]",
      "text-[10px]",
      "font-semibold",
    ]) {
      expect(bar, `tab is missing ${cls}`).toContain(cls);
    }
    expect(bar).toContain("size-[19px]");
  });

  it("uses the masthead's active/inactive token pairing", () => {
    expect(bar).toContain("text-rv-ink");
    expect(bar).toContain("text-rv-green");
    expect(bar).toContain("text-rv-ink-faded");
    expect(bar).toContain("text-rv-ink-subtle");
  });

  it("puts no background pill on the active tab — at five across it reads as a button", () => {
    expect(bar.slice(0, bar.indexOf("</nav>"))).not.toContain("bg-rv-navy-soft");
  });
});

describe("issue #19's theme toggle and the account control", () => {
  it("still decides the glyph in CSS off <html>, never in React state", () => {
    expect(nav).toContain('<Sun className="hidden size-[17px] theme-dark:block" />');
    expect(nav).toContain('<Moon className="block size-[17px] theme-dark:hidden" />');
    // No ternary anywhere picks between the two glyphs.
    expect(navCode).not.toMatch(/\?\s*<Sun/);
    expect(navCode).not.toMatch(/\?\s*<Moon/);
  });

  it("keeps the button's shipped handler, labels and className", () => {
    expect(navFlat).toContain(
      'setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark")',
    );
    expect(navFlat).toContain('title={dark ? "Switch to light theme" : "Switch to dark theme"}');
    expect(navFlat).toContain(
      'aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}',
    );
    expect(navFlat).toContain(
      'className="inline-flex size-8 cursor-pointer items-center justify-center rounded-rv-md border border-rv-border bg-transparent text-rv-ink-faded hover:text-rv-ink"',
    );
  });

  it("puts the toggle, + Capture and <Account/> in one cluster shown from md up (#173 · Q2 B)", () => {
    const cluster = navFlat.slice(
      navFlat.indexOf('<div className="hidden items-center gap-2.5 md:inline-flex">'),
    );
    expect(cluster.length).toBeLessThan(navFlat.length);
    const body = cluster.slice(0, cluster.indexOf("</div>"));
    expect(body).toContain("setTheme(");
    expect(body).toContain("+ Capture");
    expect(body).toContain("<Account />");
  });
});

describe("PageShell — one page gutter, six call sites", () => {
  it("carries the mobile-first gutter, with the shipped desktop values behind md", () => {
    expect(shellFlat).toContain(
      'className="mx-auto w-full max-w-[1120px] px-4 pt-6 pb-[calc(88px_+_env(safe-area-inset-bottom))] md:px-7 md:pt-9 md:pb-[72px]"',
    );
  });

  it("spells the calc with underscores — Tailwind drops `calc(88px+…)` as unparseable", () => {
    // …in the CODE: the doc comment above it names the broken form on purpose.
    expect(code(shell)).not.toContain("calc(88px+env");
  });

  it("is the <main> landmark, so the six call sites keep theirs", () => {
    expect(shellFlat).toContain("<main");
    expect(shellFlat).toContain("</main>");
  });

  it("is imported and rendered by all six former copies of the gutter", () => {
    for (const site of GUTTER_SITES) {
      const src = read(site);
      expect(src, `${site} does not import PageShell`).toMatch(
        /import \{ PageShell \} from "@\/components\/nav\/PageShell"|from "\.\/PageShell"/,
      );
      expect(src, `${site} does not render PageShell`).toContain("<PageShell>");
      expect(src, `${site} still has a <main> of its own`).not.toContain("<main");
    }
  });

  it("leaves no copy of the old gutter literal anywhere under apps/web/src", () => {
    const literal = "max-w-[1120px] px-7 pb-[72px] pt-9";
    const offenders = webSources().filter((p) => read(p).includes(literal));
    expect(offenders).toEqual([]);
  });
});
