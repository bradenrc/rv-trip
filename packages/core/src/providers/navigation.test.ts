import { describe, it, expect } from "vitest";
import { buildNavigationHandoff } from "./navigation";

const NEWPORT = { lat: 44.6365, lng: -124.053 };
const BEND = { lat: 44.0582, lng: -121.3153 };

describe("buildNavigationHandoff", () => {
  it("is a plain origin/destination driving link", () => {
    expect(buildNavigationHandoff(NEWPORT, BEND).url).toBe(
      "https://www.google.com/maps/dir/?api=1&origin=44.6365,-124.0530&destination=44.0582,-121.3153&travelmode=driving",
    );
  });

  it("never carries an intermediate waypoint", () => {
    // Google's URL scheme has no pass-through waypoint: anything in
    // `waypoints=` becomes a destination and gets snapped to an address, which
    // testing showed lands drivers on farm lanes and forest roads. The
    // corridor-faithful handoff is a fast-follow, server-side; this link is
    // origin → destination and nothing else.
    const url = buildNavigationHandoff(NEWPORT, BEND).url;
    expect(url).not.toContain("waypoints");
    expect(url.split("&")).toHaveLength(4);
  });

  it("formats both coordinates to 4 decimal places", () => {
    const { url } = buildNavigationHandoff(
      { lat: 44.63651234, lng: -124.05299999 },
      { lat: 0, lng: 0 },
    );
    expect(url).toContain("origin=44.6365,-124.0530");
    expect(url).toContain("destination=0.0000,0.0000");
  });

  it("takes an options object without changing today's link (the v2 seam)", () => {
    // v2 (server-validated corridor intermediates, a HERE WeGo option) extends
    // the options object — call sites must not have to change again.
    expect(buildNavigationHandoff(NEWPORT, BEND, {}).url).toBe(
      buildNavigationHandoff(NEWPORT, BEND).url,
    );
  });

  it("is pure — same input, same link, no network", () => {
    expect(buildNavigationHandoff(NEWPORT, BEND)).toEqual(buildNavigationHandoff(NEWPORT, BEND));
  });
});
