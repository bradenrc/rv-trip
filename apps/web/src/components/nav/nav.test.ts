import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #111 i4 · Q5 A ("Saves"): the library's nav item is labelled Saves while its
 * URL stays /places (docs/design/111 "Web parity"). Nav.tsx declares `LINKS`
 * once and renders it twice — the desktop row and the phone tab bar — so the
 * one entry is both labels.
 *
 * Asserted as source, the way packages/core/src/web-shell.test.ts already
 * reads this file: the component pulls in Clerk and next/navigation, and this
 * vitest has no DOM to render it into.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const nav = readFileSync(join(HERE, "Nav.tsx"), "utf8");
const links = nav.slice(nav.indexOf("const LINKS"), nav.indexOf("];", nav.indexOf("const LINKS")));

describe("the nav's library item", () => {
  it("is labelled 'Saves' and keeps its /places URL", () => {
    expect(links).toContain('{ href: "/places", label: "Saves", Icon: Bookmark,');
  });

  it("no longer says 'Places' anywhere in the list", () => {
    expect(links).not.toContain('label: "Places"');
  });

  it("keeps the five labels in their shipped order", () => {
    expect([...links.matchAll(/label: "([^"]*)"/g)].map((m) => m[1])).toEqual([
      "Trips",
      "Saves",
      "Map",
      "Rig",
      "Settings",
    ]);
  });
});
