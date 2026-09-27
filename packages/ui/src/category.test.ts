import { describe, expect, it } from "vitest";
import { Caravan, Plane, Ship } from "lucide-react";
import { categoryMeta } from "./category";

/** #112 · klunk row 6 — the Travel tile names its mode; the colours do not move. */
describe("categoryMeta(type, mode?)", () => {
  it("draws a flight as a Plane and a ferry as a Ship", () => {
    expect(categoryMeta("transport", "fly").Icon).toBe(Plane);
    expect(categoryMeta("transport", "ferry").Icon).toBe(Ship);
  });

  it("keeps the Caravan when no mode is given — every shipped caller", () => {
    expect(categoryMeta("transport").Icon).toBe(Caravan);
    expect(categoryMeta("transport", "drive").Icon).toBe(Caravan);
  });

  it("changes the glyph only: Travel's colours are the same for every mode", () => {
    const { Icon: _a, ...plain } = categoryMeta("transport");
    const { Icon: _b, ...flown } = categoryMeta("transport", "fly");
    expect(flown).toEqual(plain);
  });

  it("ignores the mode off Travel — a stay is a stay", () => {
    expect(categoryMeta("lodging", "fly")).toEqual(categoryMeta("lodging"));
  });
});
