import { describe, it, expect } from "vitest";
import { buildNavigationHandoff, MAX_GOOGLE_WAYPOINTS } from "./navigation";
import type { LatLng } from "./index";

const NEWPORT = { lat: 44.6365, lng: -124.053 };
const BEND = { lat: 44.0582, lng: -121.3153 };

/** A straight line from a to b, n intermediate samples included. */
function line(a: LatLng, b: LatLng, n: number): LatLng[] {
  return Array.from({ length: n }, (_, i) => ({
    lat: a.lat + ((b.lat - a.lat) * i) / (n - 1),
    lng: a.lng + ((b.lng - a.lng) * i) / (n - 1),
  }));
}

/** The same endpoints, bowed north — the safe corridor around the tunnel. */
function bowed(a: LatLng, b: LatLng, n: number, bulgeDeg: number): LatLng[] {
  return line(a, b, n).map((p, i) => ({
    lat: p.lat + bulgeDeg * Math.sin((Math.PI * i) / (n - 1)),
    lng: p.lng,
  }));
}

describe("buildNavigationHandoff", () => {
  it("pins the corridor: waypoints sampled where the two routes diverge most", () => {
    const handoff = buildNavigationHandoff({
      from: NEWPORT,
      to: BEND,
      safePath: bowed(NEWPORT, BEND, 40, 0.6),
      naivePath: line(NEWPORT, BEND, 40),
    });
    expect(handoff.waypoints.length).toBeGreaterThan(0);
    expect(handoff.waypoints.length).toBeLessThanOrEqual(MAX_GOOGLE_WAYPOINTS);
    expect(handoff.url).toContain("waypoints=");
  });

  it("zero divergence → zero waypoints → a plain origin/destination link", () => {
    const path = line(NEWPORT, BEND, 40);
    const handoff = buildNavigationHandoff({
      from: NEWPORT,
      to: BEND,
      safePath: path,
      naivePath: path,
    });
    expect(handoff.waypoints).toEqual([]);
    expect(handoff.url).not.toContain("waypoints");
  });

  it("no naive polyline available → same thing", () => {
    const handoff = buildNavigationHandoff({
      from: NEWPORT,
      to: BEND,
      safePath: bowed(NEWPORT, BEND, 40, 0.6),
      naivePath: null,
    });
    expect(handoff.waypoints).toEqual([]);
    expect(handoff.url).not.toContain("waypoints");
  });

  it("no safe polyline either → still a usable link (Google does not need our corridor to find Bend)", () => {
    const handoff = buildNavigationHandoff({ from: NEWPORT, to: BEND });
    expect(handoff.waypoints).toEqual([]);
    expect(handoff.url).toBe(
      "https://www.google.com/maps/dir/?api=1&origin=44.6365,-124.0530&destination=44.0582,-121.3153&travelmode=driving",
    );
  });

  it("caps at Google's waypoint limit", () => {
    // A saw-tooth diverges everywhere, so the cap — not the sampling — binds.
    const naive = line(NEWPORT, BEND, 120);
    const safe = naive.map((p, i) => ({ lat: p.lat + (i % 2 ? 0.5 : -0.5), lng: p.lng }));
    const handoff = buildNavigationHandoff({ from: NEWPORT, to: BEND, safePath: safe, naivePath: naive });
    expect(handoff.waypoints).toHaveLength(MAX_GOOGLE_WAYPOINTS);
  });

  it("drops a waypoint that sits within ~2 mi of one already chosen", () => {
    const naive = line(NEWPORT, BEND, 200);
    const safe = naive.map((p, i) => ({
      // One tight cluster of near-identical divergent points in the middle —
      // ~1.1 km apart along a ~227 km route, so well inside the 2 mi threshold.
      lat: p.lat + (i >= 99 && i <= 101 ? 0.5 : 0),
      lng: p.lng,
    }));
    const handoff = buildNavigationHandoff({ from: NEWPORT, to: BEND, safePath: safe, naivePath: naive });
    expect(handoff.waypoints).toHaveLength(1);
  });

  it("keeps waypoints in travel order, not in divergence order", () => {
    const naive = line(NEWPORT, BEND, 60);
    const safe = naive.map((p, i) => ({
      // Divergence grows toward the end, so sorting by divergence would reverse them.
      lat: p.lat + (i > 5 && i < 55 ? i * 0.02 : 0),
      lng: p.lng,
    }));
    const handoff = buildNavigationHandoff({ from: NEWPORT, to: BEND, safePath: safe, naivePath: naive });
    const lngs = handoff.waypoints.map((w) => w.lng);
    expect([...lngs].sort((a, b) => a - b)).toEqual(lngs);
  });

  it("never pins the origin or the destination as a waypoint", () => {
    const naive = line(NEWPORT, BEND, 40);
    const safe = bowed(NEWPORT, BEND, 40, 0.6);
    const handoff = buildNavigationHandoff({ from: NEWPORT, to: BEND, safePath: safe, naivePath: naive });
    for (const w of handoff.waypoints) {
      expect(w).not.toEqual(NEWPORT);
      expect(w).not.toEqual(BEND);
    }
  });

  it("formats coordinates to 4 decimal places and separates waypoints with a pipe", () => {
    const handoff = buildNavigationHandoff({
      from: NEWPORT,
      to: BEND,
      safePath: bowed(NEWPORT, BEND, 40, 0.6),
      naivePath: line(NEWPORT, BEND, 40),
    });
    const waypointParam = /&waypoints=([^&]+)/.exec(handoff.url)![1]!;
    expect(waypointParam.split("|")).toHaveLength(handoff.waypoints.length);
    for (const coord of waypointParam.split("|")) {
      expect(coord).toMatch(/^-?\d+\.\d{4},-?\d+\.\d{4}$/);
    }
  });
});
