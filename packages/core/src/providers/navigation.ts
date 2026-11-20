import { discreteFrechet, withinCorridor } from "./frechet";
import type { LatLng } from "./index";

/**
 * The navigation handoff (docs/design/9 §6, extended by docs/design/43 §4).
 *
 * HERE found a corridor that clears our rig; Google is the thing people
 * actually drive with. The Google URL is STILL the two endpoints and nothing
 * else: `dir/?api=1` has no pass-through waypoint — every coordinate in
 * `waypoints=` becomes a destination and is snapped to the nearest address,
 * which testing showed lands drivers on farm lanes and forest roads.
 *
 * What #36 adds is not a better URL, it is an ANSWER about that URL. The
 * corridor is shaped server-side (providers/google-routes.ts: `computeRoutes`
 * with `via` intermediates sampled off the HERE polyline) and Google's answer is
 * held against the HERE geometry with `discreteFrechet`. Inside
 * CORRIDOR_TOLERANCE_METERS the handoff may say it was checked; outside it, the
 * caption stays amber and the WeGo option leads.
 *
 * Still pure and network-free. The billable call happens in the quarantined
 * Google client; this function only ever receives geometry, or a number that
 * was measured earlier (the cached `routes.nav` row).
 *
 * Because this link is STILL not guaranteed to be the RV-safe corridor, the
 * drive's HERE notices render right next to the Navigate action and never
 * dismiss on handoff — the caption next to the button is the whole honesty of
 * the feature.
 */

/** Google's verdict about itself, as the screen renders it. */
export type NavigationVerdict = "checked" | "plain";

export interface NavigationHandoff {
  /** Google Maps — endpoints only. Unchanged, character for character. */
  url: string;
  /** HERE WeGo, the corridor's own vendor. */
  wegoUrl: string;
  verdict: NavigationVerdict;
  /** How far Google's path wandered from the HERE corridor, in meters. `null`
   * when the check never ran (no key, no corridor, a vendor failure). */
  deviationMeters: number | null;
}

/**
 * What the (billable) corridor check produced, cached verbatim in
 * `routes.nav` — same key, same 30-day TTL as the route it validates
 * (docs/design/43 §4). A row with `deviationMeters: null` is a check that RAN
 * and could not conclude; it is cached too, so a dead end is paid for once.
 */
export interface NavCheck {
  /**
   * How far the route the HANDOFF URL yields — Google asked for the two
   * endpoints and nothing else — ran from the HERE corridor, in meters. `null`
   * when the check could not conclude. This is the only number a verdict is
   * ever made of, because it is the only one that describes the route the
   * driver actually gets.
   */
  deviationMeters: number | null;
  /**
   * How close Google came when we HINTED the corridor with `via` points
   * (docs/design/43 §4's 180 m). Reported, never the verdict: the deep link
   * cannot carry those hints, so a "checked" badge made of this number would
   * describe a route nobody drives. Kept because it is what a future
   * turn-by-turn handoff — one that CAN carry a shaped route — would read, and
   * because it is the difference between "Google disagrees" and "Google cannot
   * be persuaded". Absent when the hinted pass never ran.
   */
  shapedDeviationMeters?: number | null;
  /** The via points we sampled and sent — kept so the sample is debuggable. */
  intermediates: LatLng[];
}

/**
 * The v2 seam, now occupied.
 *
 * The deviation can arrive two ways, and both are pure: hand over the two
 * geometries and this measures them, or hand over a `deviationMeters` measured
 * earlier (the cached row) and this only applies the threshold. The client
 * takes the second path — `toDrive` runs inside a useMemo and must not pay
 * O(n·m) haversines per drive.
 */
export interface NavigationHandoffOptions {
  /** The HERE geometry the rig was cleared for. */
  corridor?: LatLng[];
  /**
   * Google's answer, to hold the corridor against. Supplied only on the server
   * (where the billable call just returned), so that the measurement and the
   * threshold stay one expression.
   */
  googleCorridor?: LatLng[];
  /**
   * A deviation measured earlier, in meters — `routes.nav.deviationMeters`.
   * Wins over `googleCorridor` when both are given.
   */
  deviationMeters?: number | null;
}

export function buildNavigationHandoff(
  origin: LatLng,
  destination: LatLng,
  options: NavigationHandoffOptions = {},
): NavigationHandoff {
  const url = [
    "https://www.google.com/maps/dir/?api=1",
    `origin=${coord(origin)}`,
    `destination=${coord(destination)}`,
    "travelmode=driving",
  ].join("&");

  const deviationMeters = measure(options);
  // "checked" is a claim about GOOGLE's path, so it takes a measurement of one.
  // No corridor, no check, or a check that failed the threshold → "plain", and
  // the amber caption and the HERE notices carry the caveat exactly as shipped.
  const verdict: NavigationVerdict = withinCorridor(deviationMeters) ? "checked" : "plain";

  return { url, wegoUrl: wegoUrl(origin, destination), verdict, deviationMeters };
}

/**
 * The three plain Navigate links every drive carries (#180 · q1 A): Google,
 * Apple Maps and Waze, each handed the arriving destination and nothing else.
 * No origin — every app starts from where the phone IS, which at a fuel stop is
 * the only honest origin. Same 4-decimal coordinate as the handoff above.
 *
 * These make no RV-safety claim at all; the rig-on "RV route" line
 * (buildNavigationHandoff's url + wegoUrl + verdict) is where that lives.
 */
export interface NavigateLinks {
  google: string;
  apple: string;
  waze: string;
}

export function navigateLinks(to: LatLng): NavigateLinks {
  const at = coord(to);
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${at}&travelmode=driving`,
    apple: `https://maps.apple.com/?daddr=${at}&dirflg=d`,
    waze: `https://waze.com/ul?ll=${at}&navigate=yes`,
  };
}

/**
 * The Place screen's Go row (#197 · #193, docs/design/197 §6): the same three
 * apps, handed one SAVED place rather than a drive's destination.
 *
 * - A Google place (an id AND a point) → Google opens the real listing through
 *   `destination_place_id` with the name as `destination`; Apple and Waze still
 *   get the 4-decimal point, plus the name as `q=` (whether they show it is a
 *   walk check — the link navigates either way).
 * - Coordinates only (a dropped pin) → byte-identical to `navigateLinks`: a
 *   pin's name is the user's label, not a place, so it is never sent.
 * - No point → `null`: there is no Go block. An id with no point is null too —
 *   Apple and Waze have nothing to navigate to, and the row is three equal
 *   buttons or none.
 */
export interface NavigatePlace {
  name: string;
  lat: number | null;
  lng: number | null;
  googlePlaceId: string | null;
}

export function navigateLinksForPlace(place: NavigatePlace): NavigateLinks | null {
  if (place.lat == null || place.lng == null) return null;
  const to = { lat: place.lat, lng: place.lng };
  const id = place.googlePlaceId?.trim();
  const name = place.name.trim();
  if (!id || !name) return navigateLinks(to);
  const at = coord(to);
  const q = encodeURIComponent(name);
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${q}&destination_place_id=${encodeURIComponent(id)}&travelmode=driving`,
    apple: `https://maps.apple.com/?daddr=${at}&q=${q}&dirflg=d`,
    waze: `https://waze.com/ul?ll=${at}&q=${q}&navigate=yes`,
  };
}

/**
 * The deviation, from whichever input carries it. `null` — "the check never
 * ran" — is a different answer from a large number, and only a number can ever
 * produce a "checked" verdict.
 */
function measure(options: NavigationHandoffOptions): number | null {
  if (options.deviationMeters !== undefined && options.deviationMeters !== null) {
    return options.deviationMeters;
  }
  const here = options.corridor ?? [];
  const other = options.googleCorridor ?? [];
  // A single point is not a traversal, and a corridor with no Google answer
  // beside it has not been checked — both are `null`, not a big number.
  if (here.length < 2 || other.length < 2) return null;
  return discreteFrechet(here, other);
}

/**
 * HERE WeGo, drive mode, the same two endpoints in the same 4-decimal format.
 *
 * WeGo's public deep link carries NO vehicle dimensions — there is no
 * documented parameter set for height/width/length/weight, and this worktree
 * has no HERE credentials to demonstrate one against. So this URL is honestly
 * "WeGo, these two points"; the rig profile is the driver's own setting in that
 * app, and the menu copy must not promise more than that (the vet's FLAG on
 * §4's "honours … natively" string). The URL itself is render-required at the
 * walk.
 */
function wegoUrl(origin: LatLng, destination: LatLng): string {
  return `https://wego.here.com/directions/drive/${coord(origin)}/${coord(destination)}`;
}

function coord(p: LatLng): string {
  return `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
}
