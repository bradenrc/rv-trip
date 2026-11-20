import type { ReservationType } from "../domain/types";
import { categoryOf, type RvCategory } from "../theme/tokens";

/**
 * The doors out (#82) — where the internet is, for one named thing.
 *
 * A pure, table-driven URL builder: `name` and `locality` in, a list of links
 * out. No fetch, no env, no place id and no key, so it is safe in any bundle
 * and on either half of the theme. Deliberately the SAME shape as the shipped
 * `navigationOptions(drive)` (packages/core/src/planner/index.ts) — the app has
 * one idiom for "build outbound links from data we already hold", not two.
 *
 * Two groups never change (google · social). The third follows the five-category
 * language `categoryMeta` already speaks, so a lunch idea never offers you
 * Campendium and a transport row gets no third group at all. Eleven templates;
 * the most a single row ever renders is nine doors (Stay and Do), Eat renders
 * eight and Travel/Other six.
 *
 * #197 · #193 moved this table from packages/ui into core so the phone's Place
 * screen draws the same doors (as text chips, q2 A). Core reads the category
 * WORD from `categoryOf` (theme/tokens.ts), not ui's `categoryMeta`, because it
 * needs no icon; packages/ui re-exports every name here unchanged, and keeps
 * the web-only favicon table (`DRILL_MARKS` / `drillMarkId`).
 */

export type DrillDoorId =
  | "google"
  | "google-ai"
  | "google-img"
  | "reddit"
  | "instagram"
  | "facebook"
  | "dyrt"
  | "campendium"
  | "youtube"
  | "yelp"
  | "alltrails"
  | "tripadvisor";

export type DrillGroup = "google" | "social" | "category";

export interface DrillDoor {
  id: DrillDoorId;
  group: DrillGroup;
  /** the tooltip AND the accessible name — never rendered as visible text on
   * the web, where the favicon mark is the face */
  title: string;
  /** #197 · #193: the short visible name — the phone's text chip ("AI Mode",
   * "The Dyrt"). The web's DrillRow does not render it. */
  label: string;
  url: string;
  /** the modifier badge (#82 Q1 → B). Undefined on every door but the Google trio. */
  badge?: "✦" | "▦";
}

/**
 * The AI-Mode question's verb, by category. Stay/Eat/Do are the three an idea
 * can ever be (`ideaCategory` is a three-value enum); a saved place can also be
 * Travel or Other, and both read as a visit — there is no fourth verb and no
 * guess.
 */
function askVerb(cat: RvCategory): string {
  switch (cat) {
    case "Stay":
      return "staying at";
    case "Eat":
      return "eating at";
    default:
      return "visiting";
  }
}

/** "name locality", or just the name when there is no locality. */
function withLocality(name: string, locality?: string | null): string {
  const loc = locality?.trim();
  return loc ? `${name} ${loc}` : name;
}

const q = encodeURIComponent;

export interface DrillInput {
  name: string;
  /**
   * The town this thing is in. ONE resolution with three fallbacks, decided by
   * the caller: an idea attached to a destination → that destination's `placeName` (NOT NULL);
   * a saved place → `savedPlace.region` (nullable); anything else — a shelf
   * idea, a region-less saved place → none, and every template degrades to the
   * name alone. The shelf's `nearestDestinationName` is deliberately NOT a source: it
   * is a proximity fact, not this place's town, and a wrong city in the query is
   * worse than no city.
   */
  locality?: string | null;
  /** Ideas arrive through `ideaCategoryType(idea.category)`. */
  type: ReservationType;
}

export function drillDoors({ name, locality, type }: DrillInput): DrillDoor[] {
  const title = name.trim();
  if (!title) return [];
  const cat = categoryOf(type).cat;
  const loc = locality?.trim() || null;
  const nameLoc = withLocality(title, loc);
  const question = loc
    ? `What is it like ${askVerb(cat)} ${title} in ${loc}?`
    : `What is it like ${askVerb(cat)} ${title}?`;

  const doors: DrillDoor[] = [
    {
      id: "google",
      group: "google",
      label: "Google",
      title: `Google — ${title}`,
      url: `https://www.google.com/search?q=${q(nameLoc)}`,
    },
    {
      id: "google-ai",
      group: "google",
      label: "AI Mode",
      title: `Google AI Mode — ${question}`,
      url: `https://www.google.com/search?udm=50&q=${q(question)}`,
      badge: "✦",
    },
    {
      id: "google-img",
      group: "google",
      label: "Images",
      title: `Google Images — ${title}`,
      url: `https://www.google.com/search?tbm=isch&q=${q(nameLoc)}`,
      badge: "▦",
    },
    {
      id: "reddit",
      group: "social",
      label: "Reddit",
      title: `Reddit — ${title}`,
      url: `https://www.reddit.com/search/?q=${q(title)}`,
    },
    {
      id: "instagram",
      group: "social",
      label: "Instagram",
      title: `Instagram — ${title}`,
      url: `https://www.instagram.com/explore/search/keyword/?q=${q(title)}`,
    },
    {
      id: "facebook",
      group: "social",
      label: "Facebook",
      title: `Facebook — ${title}`,
      url: `https://www.facebook.com/search/top?q=${q(title)}`,
    },
  ];

  if (cat === "Stay") {
    doors.push(
      {
        id: "dyrt",
        group: "category",
        label: "The Dyrt",
        title: "The Dyrt — campground reviews",
        url: `https://thedyrt.com/search?q=${q(title)}`,
      },
      {
        id: "campendium",
        group: "category",
        label: "Campendium",
        title: "Campendium — reviews + cell signal",
        url: `https://www.campendium.com/search?search=${q(title)}`,
      },
      {
        id: "youtube",
        group: "category",
        label: "YouTube",
        title: "YouTube — park tours",
        url: `https://www.youtube.com/results?search_query=${q(`${title} tour`)}`,
      },
    );
  } else if (cat === "Eat") {
    doors.push(
      {
        id: "yelp",
        group: "category",
        label: "Yelp",
        title: `Yelp — ${title}`,
        // The one door with a real locality PARAMETER; with no locality it is
        // omitted and Yelp geolocates.
        url: loc
          ? `https://www.yelp.com/search?find_desc=${q(title)}&find_loc=${q(loc)}`
          : `https://www.yelp.com/search?find_desc=${q(title)}`,
      },
      {
        id: "tripadvisor",
        group: "category",
        label: "Tripadvisor",
        title: `Tripadvisor — ${title}`,
        url: `https://www.tripadvisor.com/Search?q=${q(nameLoc)}`,
      },
    );
  } else if (cat === "Do") {
    doors.push(
      {
        id: "alltrails",
        group: "category",
        label: "AllTrails",
        title: `AllTrails — ${title}`,
        url: `https://www.alltrails.com/search?q=${q(title)}`,
      },
      {
        id: "tripadvisor",
        group: "category",
        label: "Tripadvisor",
        title: `Tripadvisor — ${title}`,
        url: `https://www.tripadvisor.com/Search?q=${q(nameLoc)}`,
      },
      {
        id: "youtube",
        group: "category",
        label: "YouTube",
        title: `YouTube — ${title}`,
        url: `https://www.youtube.com/results?search_query=${q(title)}`,
      },
    );
  }
  // Travel and Other fall back cleanly to the two fixed groups — six doors,
  // not nine. One lookup, no second table.

  return doors;
}

/** The row's group labels, in render order. The third is the category's own
 * word, lowercased — the same five-category language, not a sixth name. */
export function drillGroupLabel(group: DrillGroup, type: ReservationType): string {
  return group === "category" ? categoryOf(type).cat.toLowerCase() : group;
}
