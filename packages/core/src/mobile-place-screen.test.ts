import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #197 · #193 — the phone Place screen, read as source.
 *
 * `apps/mobile` has no test runner, so this follows mobile-navigate.test.ts:
 * the URLs are unit tested in providers/navigation.test.ts
 * (`navigateLinksForPlace`), the doors in providers/drill.test.ts and the copy
 * in capture/place-screen.test.ts; what is pinned HERE is that the screen
 * exists on the root Stack and reads them. That the pills hand off to the
 * installed apps and the keyed G line renders is the walk's.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const path = (p: string) => join(REPO, "apps/mobile", p);
const read = (p: string) => readFileSync(path(p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("phone Place screen · the route", () => {
  it("exists at app/place/[id].tsx and is registered on the root Stack, headerless", () => {
    expect(existsSync(path("app/place/[id].tsx"))).toBe(true);
    expect(read("app/_layout.tsx")).toContain(
      '<Stack.Screen name="place/[id]" options={{ headerShown: false }} />',
    );
  });
});

describe("phone Place screen · the blocks", () => {
  const screen = read("app/place/[id].tsx");
  const body = code(screen);

  it("finds the save in useSaves() — there is no single-place read", () => {
    expect(body).toContain("const { saves, error, reload } = useSaves();");
    expect(body).toContain("saves?.find((s) => s.id === id)");
  });

  it("draws Go from navigateLinksForPlace and, with no point, the locate strip in its slot", () => {
    expect(body).toContain("const links = navigateLinksForPlace(save.place);");
    expect(body).toContain('<GoButton label="Google" url={links.google} />');
    expect(body).toContain('<GoButton label="Apple" url={links.apple} />');
    expect(body).toContain('<GoButton label="Waze" url={links.waze} />');
    expect(body).toMatch(/\) : save\.suggestedPlace \? \(\s*<Suggestion save=\{save\} \/>/);
    expect(body).toContain("onPress={() => void Linking.openURL(url)}");
  });

  it("shows Call and Website only when Google's details carry them, then On the map", () => {
    expect(body).toContain("found?.nationalPhoneNumber ?");
    expect(body).toContain("found?.websiteUri ?");
    expect(body.indexOf('label="Website"')).toBeLessThan(body.indexOf(">On the map<"));
    expect(body).toContain('router.navigate({ pathname: "/map", params: { place: save.id } })');
  });

  it("reads details through core's api client, keyed by the Google id", () => {
    expect(body).toContain(".details(googlePlaceId)");
    expect(body).toContain('if (!googlePlaceId) return { state: "none" };');
    expect(body).toContain("G — checking…");
    expect(body).toContain("placeGoogleLine(details.place)");
  });

  it("writes the shelf and the stars through patchSave", () => {
    expect(body).toContain("patchSave(save.id, { status })");
    expect(body).toContain("patchSave(save.id, { rating: n === 0 ? null : n })");
    expect(body).toContain("<AgainBadge again={save.again} />");
  });

  it("keeps the order: what it is · Go · Yours · What others say", () => {
    const at = (s: string) => body.indexOf(s);
    expect(at("placeScreenMeta(save)")).toBeLessThan(at(">Go<"));
    expect(at(">Go<")).toBeLessThan(at(">Yours<"));
    expect(at(">Yours<")).toBeLessThan(at(">What others say<"));
  });

  it("draws core's doors grouped, as text chips with their visible label", () => {
    expect(body).toContain("drillDoors({ name: save.place.name, locality: save.region, type: save.type })");
    expect(body).toContain("drillGroupLabel(g, save.type)");
    expect(body).toContain("{door.label}");
  });

  it("names no raw colour", () => {
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
