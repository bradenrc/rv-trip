import { describe, expect, it } from "vitest";
import { DRILL_MARKS, drillDoors, drillGroupLabel, drillMarkId, type DrillDoor } from "./drill";

/**
 * The door contract (docs/design/82 §5). Eleven templates is precisely the thing
 * that rots silently, so every URL asserted here is the LITERAL string the
 * wireframe renders beside its template — not a re-derivation of the builder.
 */

const KOA = { name: "Astoria/Warrenton KOA", locality: "Astoria, OR", type: "campground" } as const;

const url = (doors: DrillDoor[], id: DrillDoor["id"]) => doors.find((d) => d.id === id)?.url;
const ids = (doors: DrillDoor[]) => doors.map((d) => d.id);

describe("drillDoors · the google + social groups, which never change", () => {
  it("renders the wireframe's literal Google trio for a Stay with a locality", () => {
    const doors = drillDoors(KOA);
    expect(url(doors, "google")).toBe(
      "https://www.google.com/search?q=Astoria%2FWarrenton%20KOA%20Astoria%2C%20OR",
    );
    expect(url(doors, "google-ai")).toBe(
      "https://www.google.com/search?udm=50&q=What%20is%20it%20like%20staying%20at%20Astoria%2FWarrenton%20KOA%20in%20Astoria%2C%20OR%3F",
    );
    expect(url(doors, "google-img")).toBe(
      "https://www.google.com/search?tbm=isch&q=Astoria%2FWarrenton%20KOA%20Astoria%2C%20OR",
    );
  });

  it("badges the two modifier doors and nothing else", () => {
    const doors = drillDoors(KOA);
    expect(doors.filter((d) => d.badge).map((d) => [d.id, d.badge])).toEqual([
      ["google-ai", "✦"],
      ["google-img", "▦"],
    ]);
  });

  it("searches social on the bare NAME — no locality anywhere in the three", () => {
    const doors = drillDoors(KOA);
    expect(url(doors, "reddit")).toBe(
      "https://www.reddit.com/search/?q=Astoria%2FWarrenton%20KOA",
    );
    expect(url(doors, "instagram")).toBe(
      "https://www.instagram.com/explore/search/keyword/?q=Astoria%2FWarrenton%20KOA",
    );
    expect(url(doors, "facebook")).toBe(
      "https://www.facebook.com/search/top?q=Astoria%2FWarrenton%20KOA",
    );
  });

  it("carries the title as the tooltip AND the accessible name, never as text", () => {
    const doors = drillDoors(KOA);
    expect(doors.find((d) => d.id === "google")?.title).toBe("Google — Astoria/Warrenton KOA");
    expect(doors.find((d) => d.id === "google-ai")?.title).toBe(
      "Google AI Mode — What is it like staying at Astoria/Warrenton KOA in Astoria, OR?",
    );
  });
});

describe("drillDoors · the third group follows the category", () => {
  it("Stay → The Dyrt · Campendium · YouTube, and YouTube asks for a tour", () => {
    const doors = drillDoors(KOA);
    expect(ids(doors).slice(6)).toEqual(["dyrt", "campendium", "youtube"]);
    expect(url(doors, "dyrt")).toBe("https://thedyrt.com/search?q=Astoria%2FWarrenton%20KOA");
    expect(url(doors, "campendium")).toBe(
      "https://www.campendium.com/search?search=Astoria%2FWarrenton%20KOA",
    );
    expect(url(doors, "youtube")).toBe(
      "https://www.youtube.com/results?search_query=Astoria%2FWarrenton%20KOA%20tour",
    );
    expect(doors).toHaveLength(9);
  });

  it("Eat → Yelp (the one door with a real locality parameter) + Tripadvisor", () => {
    const doors = drillDoors({
      name: "Rogue Ales brewery lunch",
      locality: "Newport, OR",
      type: "dining",
    });
    expect(ids(doors).slice(6)).toEqual(["yelp", "tripadvisor"]);
    expect(url(doors, "yelp")).toBe(
      "https://www.yelp.com/search?find_desc=Rogue%20Ales%20brewery%20lunch&find_loc=Newport%2C%20OR",
    );
    expect(doors).toHaveLength(8);
    expect(doors.find((d) => d.id === "google-ai")?.title).toContain("eating at");
  });

  it("Do → AllTrails · Tripadvisor · YouTube, and Tripadvisor carries the locality", () => {
    const doors = drillDoors({
      name: "Oregon Coast Aquarium",
      locality: "Newport, OR",
      type: "activity",
    });
    expect(ids(doors).slice(6)).toEqual(["alltrails", "tripadvisor", "youtube"]);
    expect(url(doors, "alltrails")).toBe(
      "https://www.alltrails.com/search?q=Oregon%20Coast%20Aquarium",
    );
    expect(url(doors, "tripadvisor")).toBe(
      "https://www.tripadvisor.com/Search?q=Oregon%20Coast%20Aquarium%20Newport%2C%20OR",
    );
    expect(url(doors, "youtube")).toBe(
      "https://www.youtube.com/results?search_query=Oregon%20Coast%20Aquarium",
    );
    expect(doors.find((d) => d.id === "google-ai")?.title).toContain("visiting");
  });

  it("Travel and Other fall back to the two fixed groups — six doors, not nine", () => {
    for (const type of ["transport", "other"] as const) {
      const doors = drillDoors({ name: "Ferry to Puget Sound", type });
      expect(doors).toHaveLength(6);
      expect(doors.some((d) => d.group === "category")).toBe(false);
    }
  });

  it("covers every reservation type without throwing", () => {
    const types = [
      "campground",
      "lodging",
      "dining",
      "event",
      "tour",
      "activity",
      "transport",
      "other",
    ] as const;
    for (const type of types) {
      const doors = drillDoors({ name: "Anywhere", type });
      expect(doors.length).toBeGreaterThanOrEqual(6);
      expect(new Set(doors.map((d) => d.id)).size).toBe(doors.length);
    }
  });
});

describe("drillDoors · no locality", () => {
  const shelf = { name: "Deschutes River float", type: "activity" } as const;

  it("drops the ' in <locality>' clause from the AI-Mode question", () => {
    const doors = drillDoors(shelf);
    expect(url(doors, "google-ai")).toBe(
      "https://www.google.com/search?udm=50&q=What%20is%20it%20like%20visiting%20Deschutes%20River%20float%3F",
    );
    expect(url(doors, "google")).toBe(
      "https://www.google.com/search?q=Deschutes%20River%20float",
    );
  });

  it("omits Yelp's find_loc rather than sending a blank one", () => {
    const doors = drillDoors({ name: "Rogue Ales brewery lunch", type: "dining" });
    expect(url(doors, "yelp")).toBe(
      "https://www.yelp.com/search?find_desc=Rogue%20Ales%20brewery%20lunch",
    );
  });

  it("treats a blank or whitespace locality as no locality at all", () => {
    for (const locality of ["", "   ", null, undefined]) {
      expect(drillDoors({ ...shelf, locality })).toEqual(drillDoors(shelf));
    }
  });

  it("answers an empty name with no doors — a blank row is not a question", () => {
    expect(drillDoors({ name: "   ", type: "campground" })).toEqual([]);
  });
});

describe("drillDoors · encoding", () => {
  it("percent-encodes every value, so an ampersand can never split a query", () => {
    const doors = drillDoors({ name: "Bed & Breakfast #1", locality: "A/B, WA", type: "lodging" });
    for (const door of doors) {
      const query = door.url.slice(door.url.indexOf("?") + 1);
      expect(query).not.toContain("Bed & Breakfast");
      expect(query).toContain("Bed%20%26%20Breakfast%20%231");
    }
  });
});

describe("the marks", () => {
  it("is ten marks for twelve doors — the Google trio share one", () => {
    expect(DRILL_MARKS).toHaveLength(10);
    expect(drillMarkId("google-ai")).toBe("google");
    expect(drillMarkId("google-img")).toBe("google");
    expect(drillMarkId("dyrt")).toBe("thedyrt");
  });

  it("has a mark for every door id the builder can emit", () => {
    const marks = new Set(DRILL_MARKS.map((m) => m.id));
    const types = ["campground", "dining", "activity", "transport"] as const;
    for (const type of types) {
      for (const door of drillDoors({ name: "Anywhere", locality: "Town, ST", type })) {
        expect(marks.has(drillMarkId(door.id))).toBe(true);
      }
    }
  });
});

describe("drillGroupLabel", () => {
  it("names the third group with the category's own word, lowercased", () => {
    expect(drillGroupLabel("category", "campground")).toBe("stay");
    expect(drillGroupLabel("category", "dining")).toBe("eat");
    expect(drillGroupLabel("category", "activity")).toBe("do");
    expect(drillGroupLabel("google", "campground")).toBe("google");
    expect(drillGroupLabel("social", "campground")).toBe("social");
  });
});
