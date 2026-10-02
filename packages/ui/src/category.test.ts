import { describe, expect, it } from "vitest";
import { Bus, Caravan, Plane, Ship } from "lucide-react";
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

/** #155 · Q4 A — the booking's own kind wins over the hop's mode. */
describe("categoryMeta(type, mode, transportKind)", () => {
  it("draws a shuttle as a Bus, a flight as a Plane and a ferry as a Ship — on any hop", () => {
    expect(categoryMeta("transport", "fly", "shuttle").Icon).toBe(Bus);
    expect(categoryMeta("transport", "fly", "flight").Icon).toBe(Plane);
    expect(categoryMeta("transport", "drive", "ferry").Icon).toBe(Ship);
  });

  it("train and car keep the mode fallback — no icon was decided for them", () => {
    expect(categoryMeta("transport", "drive", "train").Icon).toBe(Caravan);
    expect(categoryMeta("transport", "fly", "car").Icon).toBe(Plane);
    expect(categoryMeta("transport", "fly", null).Icon).toBe(Plane);
  });

  it("is still Travel's colours, and ignored off Travel", () => {
    const { Icon: _a, ...plain } = categoryMeta("transport");
    const { Icon: _b, ...bus } = categoryMeta("transport", "fly", "shuttle");
    expect(bus).toEqual(plain);
    expect(categoryMeta("lodging", "fly", "shuttle")).toEqual(categoryMeta("lodging"));
  });
});
