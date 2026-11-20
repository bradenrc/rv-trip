import { describe, expect, it } from "vitest";
import { drillDoors, drillGroupLabel, type DrillDoor } from "./drill";

/**
 * #197 · #193 — the doors moved into core so the phone can draw them as text
 * chips (q2 A). The URL contract itself stays pinned, literal for literal, in
 * packages/ui/src/drill.test.ts (which imports through the ui re-export); what
 * is pinned HERE is the per-category count and the visible `label`.
 */

const ids = (doors: DrillDoor[]) => doors.map((d) => d.id);

describe("drillDoors in core", () => {
  it("counts Eat 8, Stay 9, Do 9 (Travel and Other fall back to six)", () => {
    expect(drillDoors({ name: "Aslan Brewing Co.", locality: "Bellingham, WA", type: "dining" })).toHaveLength(8);
    expect(drillDoors({ name: "Astoria/Warrenton KOA", locality: "Astoria, OR", type: "campground" })).toHaveLength(9);
    expect(drillDoors({ name: "Chuckanut pullout", type: "activity" })).toHaveLength(9);
    expect(drillDoors({ name: "Ferry", type: "transport" })).toHaveLength(6);
    expect(drillDoors({ name: "Thing", type: "other" })).toHaveLength(6);
  });

  it("gives every door a short, non-empty visible label", () => {
    const all = [
      ...drillDoors({ name: "a", type: "dining" }),
      ...drillDoors({ name: "b", type: "campground" }),
      ...drillDoors({ name: "c", type: "activity" }),
    ];
    for (const d of all) expect(d.label.trim().length).toBeGreaterThan(0);
  });

  it("labels the twelve doors as the wireframe's chips read", () => {
    const label = (doors: DrillDoor[]) => doors.map((d) => d.label);
    expect(label(drillDoors({ name: "a", type: "dining" }))).toEqual([
      "Google",
      "AI Mode",
      "Images",
      "Reddit",
      "Instagram",
      "Facebook",
      "Yelp",
      "Tripadvisor",
    ]);
    expect(label(drillDoors({ name: "b", type: "campground" })).slice(6)).toEqual([
      "The Dyrt",
      "Campendium",
      "YouTube",
    ]);
    expect(label(drillDoors({ name: "c", type: "activity" })).slice(6)).toEqual([
      "AllTrails",
      "Tripadvisor",
      "YouTube",
    ]);
  });

  it("keeps the order google · social · category", () => {
    expect(ids(drillDoors({ name: "a", type: "dining" })).slice(0, 6)).toEqual([
      "google",
      "google-ai",
      "google-img",
      "reddit",
      "instagram",
      "facebook",
    ]);
  });

  it("names the third group with the category's own word, lowercased", () => {
    expect(drillGroupLabel("category", "dining")).toBe("eat");
    expect(drillGroupLabel("category", "lodging")).toBe("stay");
    expect(drillGroupLabel("category", "tour")).toBe("do");
    expect(drillGroupLabel("google", "dining")).toBe("google");
    expect(drillGroupLabel("social", "dining")).toBe("social");
  });
});
