import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #173 i3 · #171 · Q1 C · Q2 B — the web shell's two bars.
 *
 * The desktop row is Trips · Places · Map. Rig and Settings leave it and fold
 * under the avatar, which now links to /you. Below `md` the bottom bar is its
 * own list, the phone's five: Trips · Places · Capture · Map · You. The library
 * is "Places" again (the URL was always /places).
 *
 * Asserted as source, the way packages/core/src/web-shell.test.ts already
 * reads this file: the components pull in Clerk and next/navigation, and this
 * vitest has no DOM to render them into.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "../..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
const nav = read("components/nav/Nav.tsx");
const account = read("components/nav/Account.tsx");
const youPage = read("app/you/page.tsx");
const youAccount = read("components/you/YouAccount.tsx");
const placesPage = read("app/places/page.tsx");

/** Source with comments stripped, so a comment cannot satisfy a claim. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const flat = (s: string) => s.replace(/\s+/g, " ");

/** The body of `const <name> … = [ … ];`. */
function list(name: string): string {
  const src = code(nav);
  const start = src.indexOf(`const ${name}`);
  expect(start, `const ${name}`).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf("];", start));
}
const labels = (body: string) => [...body.matchAll(/label: "([^"]*)"/g)].map((m) => m[1]);
/** One entry of a list, by its label. */
function entry(body: string, label: string): string {
  const hit = flat(body)
    .split(/(?=\{ href:)/)
    .find((e) => e.includes(`label: "${label}"`));
  expect(hit, `${label} entry`).toBeTruthy();
  return hit!;
}

const LINKS = list("LINKS");
const TABS = list("TABS");
const navFlat = flat(code(nav));

describe("the desktop row: Trips · Places · Map", () => {
  it("has exactly the three labels, in order", () => {
    expect(labels(LINKS)).toEqual(["Trips", "Places", "Map"]);
  });

  it("points Trips at /trips, lit on anything under /trips", () => {
    const trips = entry(LINKS, "Trips");
    expect(trips).toContain('href: "/trips"');
    expect(trips).toContain('match: (p) => p.startsWith("/trips")');
  });

  it("keeps Places at /places and Map at /map", () => {
    expect(entry(LINKS, "Places")).toContain('href: "/places"');
    expect(entry(LINKS, "Map")).toContain('href: "/map"');
  });
});

describe("the bottom bar: the phone's five", () => {
  it("has Trips · Places · Capture · Map · You, in order", () => {
    expect(labels(TABS)).toEqual(["Trips", "Places", "Capture", "Map", "You"]);
  });

  it("makes Capture an action (no href) with a PlusCircle that is never lit (#176 i3)", () => {
    const capture = entry(TABS, "Capture");
    expect(capture).toContain("href: null");
    expect(capture).not.toContain('href: "/places"');
    expect(capture).toContain("Icon: PlusCircle");
    expect(capture).toContain("match: () => false");
    expect(capture).toContain("action: true");
  });

  it("renders the href-less Capture tab as a <button> that opens the capture sheet (#176 i3)", () => {
    const bar = navFlat.slice(navFlat.indexOf("TABS.map("), navFlat.lastIndexOf("</nav>"));
    expect(bar).toMatch(
      /href === null \? \( <button key=\{label\} type="button" onClick=\{\(\) => setCapturing\(true\)\}/,
    );
    expect(bar).toContain("<Link key={label} href={href}");
  });

  it("paints the action's icon green whether or not it is lit", () => {
    expect(navFlat).toContain('size-[19px] ${action || active ? "text-rv-green" :');
  });

  it("lights You on /you, /rig and /settings", () => {
    const you = entry(TABS, "You");
    expect(you).toContain('href: "/you"');
    expect(you).toContain("Icon: CircleUser");
    for (const p of ["/you", "/rig", "/settings"]) expect(you).toContain(`"${p}"`);
  });

  it("renders LINKS in the desktop row and TABS in the bottom bar, once each", () => {
    expect(code(nav).match(/LINKS\.map\(/g)).toHaveLength(1);
    expect(code(nav).match(/TABS\.map\(/g)).toHaveLength(1);
  });
});

describe("no label names Rig, Settings or Saves", () => {
  it("in either list", () => {
    for (const body of [LINKS, TABS]) {
      for (const gone of ["Rig", "Settings", "Saves"]) {
        expect(labels(body)).not.toContain(gone);
      }
    }
  });
});

describe("the masthead's right side", () => {
  const right = navFlat.slice(navFlat.indexOf('<div className="hidden items-center gap-2.5 md:inline-flex">'));

  it("wraps the toggle, + Capture and <Account/> in one hidden md:inline-flex cluster", () => {
    expect(navFlat).toContain('<div className="hidden items-center gap-2.5 md:inline-flex">');
    const cluster = right.slice(0, right.indexOf("</nav>"));
    const toggle = cluster.indexOf("<button");
    const capture = cluster.indexOf("+ Capture");
    const avatar = cluster.indexOf("<Account />");
    expect(toggle).toBeGreaterThan(-1);
    expect(capture).toBeGreaterThan(toggle);
    expect(avatar).toBeGreaterThan(capture);
  });

  it("makes + Capture a <button> (not a Link to /places) in the CTA green (#176 i3)", () => {
    expect(right).toMatch(
      /<button type="button" onClick=\{\(\) => setCapturing\(true\)\} className="[^"]*\bbg-rv-green\b[^"]*\btext-rv-navy\b[^"]*"> \+ Capture <\/button>/,
    );
    expect(right).not.toMatch(/<Link href="\/places"[^>]*> \+ Capture/);
    const cls = right.match(/className="([^"]*)"> \+ Capture <\/button>/)![1]!;
    for (const c of ["rounded-rv-md", "font-bold", "bg-rv-green", "text-rv-navy"]) expect(cls).toContain(c);
  });
});

describe("the capture sheet's mount (#176 i3 · vet MED)", () => {
  it("renders CaptureSheet once, as a sibling after both <nav> islands", () => {
    expect(navFlat.match(/<CaptureSheet /g)).toHaveLength(1);
    const at = navFlat.indexOf("<CaptureSheet ");
    expect(at).toBeGreaterThan(navFlat.lastIndexOf("</nav>"));
    expect(navFlat).toContain("{capturing ? <CaptureSheet onClose={() => setCapturing(false)} /> : null}");
  });
});

describe("Account.tsx links to /you in both auth modes", () => {
  const src = flat(code(account));

  it("drops Clerk's UserButton for a Link wearing the useUser() initial", () => {
    expect(src).not.toContain("UserButton");
    expect(src).toContain("useUser()");
    const signedIn = src.slice(src.indexOf("function YouAvatar"));
    expect(signedIn).toContain('<Link href="/you"');
    expect(signedIn).toContain("size-[30px]");
  });

  it("wraps the keyless dev-user pill in the same Link", () => {
    const dev = src.slice(src.indexOf("function DevAccount"));
    expect(dev).toContain('<Link href="/you"');
    expect(dev).toContain("dev-user");
    expect(dev).toContain("border-dashed");
  });

  it("keeps SignInButton for the signed-out case", () => {
    expect(src).toContain('<SignInButton mode="modal">');
  });
});

describe("/you", () => {
  const page = flat(code(youPage));

  it("is a server page that reads the household and the prefs", () => {
    expect(code(youPage)).not.toContain('"use client"');
    expect(page).toContain("getHouseholdOverview(");
    expect(page).toContain("getPrefsByOwner(");
  });

  it("names the actor through describePeople, the id (dev-user) keyless", () => {
    expect(page).toContain("getActor()");
    expect(page).toContain("describePeople(");
    expect(page).toContain("people[actor]?.name?.trim() || actor");
  });

  it("is a PageShell page in the Settings column, kicker You", () => {
    expect(page).toContain("<PageShell>");
    expect(page).toContain("max-w-[680px]");
    expect(page).toMatch(/text-rv-ink-faded"> You <\/div>/);
  });

  it("lists Household, Rig and Settings; Household's value is homeBaseRowValue", () => {
    expect(page).toContain('<YouLinkRow href="/settings" label="Household" value={homeBaseRowValue(prefs)} />');
    expect(page).toContain('<YouLinkRow href="/rig" label="Rig" />');
    expect(page).toContain('<YouLinkRow href="/settings" label="Settings" />');
  });

  it("hands the account card to the client island, told whether Clerk is on", () => {
    expect(page).toContain("<YouAccount clerk={clerkEnabled()} />");
  });

  it("the island: Manage account + Sign out with Clerk, the dashed dev-user stub without", () => {
    expect(youAccount.trimStart().startsWith('"use client"')).toBe(true);
    const island = flat(code(youAccount));
    expect(island).toContain("openUserProfile()");
    expect(island).toContain("<SignOutButton>");
    expect(island).toContain("Manage account");
    expect(island).toContain("Sign out");
    expect(island).toContain("Local dev — no Clerk keys, running as the seeded dev-user");
    expect(island).toContain("dashed");
  });
});

describe("places/page.tsx", () => {
  it("says 'Your places' in its kicker", () => {
    expect(placesPage).toContain("Your places");
    expect(placesPage).not.toContain("Your saves");
  });
});
