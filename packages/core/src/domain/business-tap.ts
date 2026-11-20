import { regionFromAddress } from "./place-form";
import { isAlreadySaved, matchCandidateFromSaved, reservationTypeOfGoogle } from "./places";
import type { ReservationType, SavedPlace } from "./types";

/**
 * #201 · tap a business on the Google basemap (docs/design/202 §1–§2).
 *
 * Only Google's basemap carries a Google place id on its business icons, so
 * only the Google engine can raise this card. Both clients raise the same
 * card in their pin-card slot: the name, the town, a "Google place" tag, and
 * either **Save** (capture opens at its confirm step with the place picked) or
 * **Open →** to the save's Place screen when the library already holds it.
 *
 * Everything the card decides lives here, so the web's and the phone's cards
 * cannot disagree, and so it is unit-tested (neither map surface has a DOM
 * test runner).
 */

/** The card's words, verbatim from the wireframe's `.mcard`. */
export const BUSINESS_CARD_COPY = {
  tag: "Google place",
  save: "Save",
  open: "Open →",
  saved: "saved",
} as const;

/** What a tap knows. The web's map click gives only the id (a details call
 * names it); the phone's `onPoiClick` also gives the name and the point. */
export interface TappedBusiness {
  googlePlaceId: string;
  name: string | null;
  lat?: number | null;
  lng?: number | null;
  /** Google's formatted address, from the details call. */
  address?: string | null;
  /** Google's `primaryType`, when the answer carries one. */
  primaryType?: string | null;
}

export type BusinessTap = { kind: "save" } | { kind: "open"; save: SavedPlace };

/**
 * Save or Open → for a tapped Google place. The library rule is
 * `isAlreadySaved`'s: an equal Google place id first (rule 1), across the
 * whole library, so a same-named row earlier in the list never shadows the
 * row that IS this place; then, once the tap has a name, the name +
 * coordinate rules. A tap with no name yet matches by id alone.
 */
export function businessTapAction(tapped: TappedBusiness, library: readonly SavedPlace[]): BusinessTap {
  const byId = library.find((s) => s.place.googlePlaceId === tapped.googlePlaceId);
  if (byId) return { kind: "open", save: byId };
  const name = tapped.name?.trim() ?? "";
  if (name === "") return { kind: "save" };
  const candidate = {
    name,
    lat: tapped.lat ?? null,
    lng: tapped.lng ?? null,
    googlePlaceId: tapped.googlePlaceId,
  };
  const match = library.find((s) => isAlreadySaved(candidate, [matchCandidateFromSaved(s)]));
  return match ? { kind: "open", save: match } : { kind: "save" };
}

/** The town from a Google formatted address — "Pacific City" from
 * "33180 Cape Kiwanda Dr, Pacific City, OR 97135, USA" (the wireframe's
 * line). The first half of the Region seed `regionFromAddress` makes. */
export function localityOfAddress(address: string | null | undefined): string | null {
  const region = regionFromAddress(address ?? null);
  if (!region) return null;
  const town = region.split(",")[0]?.trim() ?? "";
  return town === "" ? null : town;
}

export interface BusinessCard {
  googlePlaceId: string;
  name: string;
  /** The mono line's town; null draws the tag alone. */
  area: string | null;
  /** The category tile. */
  type: ReservationType;
  action: BusinessTap;
}

/**
 * The card a tapped business raises, or null when nothing names it yet (no
 * details answer and not in the library): a card with no name is not drawn.
 * A saved place speaks with its own name and category; an unsaved one with
 * Google's.
 */
export function businessCard(tapped: TappedBusiness, library: readonly SavedPlace[]): BusinessCard | null {
  const action = businessTapAction(tapped, library);
  const save = action.kind === "open" ? action.save : null;
  // An Android POI label can wrap ("Pelican Brewing\nPacific City"): the
  // first line is the name.
  const name = save?.place.name ?? tapped.name?.split("\n")[0]?.trim() ?? "";
  if (name.trim() === "") return null;
  return {
    googlePlaceId: tapped.googlePlaceId,
    name,
    area: localityOfAddress(tapped.address) ?? save?.area?.name ?? save?.region ?? null,
    type: save ? save.type : reservationTypeOfGoogle(tapped.primaryType),
    action,
  };
}
