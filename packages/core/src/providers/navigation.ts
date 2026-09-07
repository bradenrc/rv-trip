import type { LatLng } from "./index";

/**
 * The Google Maps handoff (docs/design/9 §6).
 *
 * HERE found a corridor that clears our rig; Google is the thing people
 * actually drive with. We hand Google the two endpoints and nothing else.
 *
 * We do NOT try to shape the corridor through the URL. Google's `dir/?api=1`
 * scheme has no pass-through waypoint: every coordinate in `waypoints=` becomes
 * a destination and is snapped to the nearest address, which testing showed
 * lands drivers on farm lanes and forest roads. A worse route with the
 * RV-safe label on it is worse than an honest plain one, so the corridor-
 * faithful version (server-side Google Routes API with `via` intermediates
 * validated against the HERE polyline, plus a HERE WeGo option) is a planned
 * fast-follow, not a URL trick.
 *
 * Because this link is NOT the RV-safe corridor, the drive's HERE notices
 * render right next to the Navigate action and never dismiss on handoff —
 * the caption next to the button is the whole honesty of the feature.
 *
 * Pure and network-free.
 */

export interface NavigationHandoff {
  url: string;
}

/**
 * The v2 seam. Nothing today — but the parameter exists so the fast-follow
 * (corridor intermediates, a HERE WeGo handoff option) extends this object
 * instead of churning every call site.
 */
export interface NavigationHandoffOptions {
  /** Reserved; no option is accepted yet. */
  readonly reserved?: never;
}

export function buildNavigationHandoff(
  origin: LatLng,
  destination: LatLng,
  /** Accepted and ignored — see NavigationHandoffOptions. */
  _options: NavigationHandoffOptions = {},
): NavigationHandoff {
  const url = [
    "https://www.google.com/maps/dir/?api=1",
    `origin=${coord(origin)}`,
    `destination=${coord(destination)}`,
    "travelmode=driving",
  ].join("&");
  return { url };
}

function coord(p: LatLng): string {
  return `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
}
