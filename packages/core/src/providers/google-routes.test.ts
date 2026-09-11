import { describe, it, expect } from "vitest";
import {
  COMPUTE_ROUTES_FIELD_MASK,
  COMPUTE_ROUTES_URL,
  MAX_VIA_POINTS,
  buildComputeRoutesBody,
  parseComputeRoutesResponse,
  sampleViaPoints,
} from "./google-routes";
import type { LatLng } from "./index";

const ASTORIA = { lat: 46.1879, lng: -123.8313 };
const NEWPORT = { lat: 44.6365, lng: -124.053 };

/** A north→south corridor, 0.1° of latitude per vertex (~11 km). */
function corridor(n: number, lng = -123.9): LatLng[] {
  return Array.from({ length: n }, (_, i) => ({ lat: 46.2 - i * 0.1, lng }));
}

describe("buildComputeRoutesBody", () => {
  it("is endpoints only when nothing was sampled", () => {
    const body = buildComputeRoutesBody(ASTORIA, NEWPORT, []);
    expect(body).toEqual({
      origin: { location: { latLng: { latitude: 46.1879, longitude: -123.8313 } } },
      destination: { location: { latLng: { latitude: 44.6365, longitude: -124.053 } } },
      travelMode: "DRIVE",
      polylineEncoding: "GEO_JSON_LINESTRING",
    });
    expect(body).not.toHaveProperty("intermediates");
  });

  it("marks every intermediate `via: true` — a pass-through, never a stop", () => {
    const body = buildComputeRoutesBody(ASTORIA, NEWPORT, [
      { lat: 46.0142, lng: -123.9231 },
      { lat: 45.7208, lng: -123.9377 },
    ]) as { intermediates: { location: unknown; via: boolean }[] };
    expect(body.intermediates).toEqual([
      { location: { latLng: { latitude: 46.0142, longitude: -123.9231 } }, via: true },
      { location: { latLng: { latitude: 45.7208, longitude: -123.9377 } }, via: true },
    ]);
    expect(body.intermediates.every((i) => i.via)).toBe(true);
  });

  it("asks for the one field the validator needs, as a GeoJSON LineString", () => {
    expect(COMPUTE_ROUTES_URL).toBe(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
    );
    expect(COMPUTE_ROUTES_FIELD_MASK).toBe("routes.polyline.geoJsonLinestring");
  });
});

describe("sampleViaPoints", () => {
  it("samples the local maxima of the pointwise distance profile, in traversal order", () => {
    const here = corridor(9);
    // Google's naive answer runs down a different meridian for two stretches,
    // giving the profile two humps with a trough between them.
    const other = here.map((p, i) => ({
      lat: p.lat,
      lng: p.lng + (i === 2 ? 0.3 : i === 3 ? 0.1 : i === 6 ? 0.4 : 0),
    }));
    const sampled = sampleViaPoints(here, other);
    expect(sampled).toEqual([here[2]!, here[6]!]);
    // Ordered by index, NOT by how bad the deviation was: `intermediates` is a
    // sequence Google drives through, so order is the route.
    expect(sampled.map((p) => here.indexOf(p))).toEqual([2, 6]);
  });

  it("never samples an endpoint — the request already carries both", () => {
    const here = corridor(5);
    const other = here.map((p, i) => ({
      lat: p.lat,
      lng: p.lng + (i === 0 || i === 4 ? 0.5 : 0),
    }));
    expect(sampleViaPoints(here, other)).toEqual([]);
  });

  it("caps the sample at 8, keeping the worst offenders", () => {
    const here = corridor(41);
    // A hump at every odd vertex, worsening as it goes south. Every hump stays
    // far smaller than the corridor's own vertex spacing, so the nearest vertex
    // of `other` to a corridor vertex is always its own twin.
    const other = here.map((p, i) => ({ lat: p.lat, lng: p.lng + (i % 2 ? 0.0002 * i : 0) }));
    const sampled = sampleViaPoints(here, other);
    expect(MAX_VIA_POINTS).toBe(8);
    expect(sampled).toHaveLength(MAX_VIA_POINTS);
    // The eight deepest humps are the eight southernmost odd vertices…
    expect(sampled.map((p) => here.indexOf(p))).toEqual([25, 27, 29, 31, 33, 35, 37, 39]);
    // …and they come back sorted by index, so they are still a traversal.
    expect([...sampled].sort((a, b) => b.lat - a.lat)).toEqual(sampled);
  });

  it("samples nothing when Google already runs the corridor", () => {
    const here = corridor(9);
    expect(sampleViaPoints(here, here)).toEqual([]);
    expect(sampleViaPoints(here, [])).toEqual([]);
    expect(sampleViaPoints([], here)).toEqual([]);
  });
});

describe("parseComputeRoutesResponse", () => {
  it("reads the GeoJSON LineString back as LatLng in traversal order", () => {
    expect(
      parseComputeRoutesResponse({
        routes: [
          {
            polyline: {
              geoJsonLinestring: {
                type: "LineString",
                coordinates: [
                  [-123.8313, 46.1879],
                  [-123.9231, 46.0142],
                  [-124.053, 44.6365],
                ],
              },
            },
          },
        ],
      }),
    ).toEqual([ASTORIA, { lat: 46.0142, lng: -123.9231 }, NEWPORT]);
  });

  it("degrades an answer it cannot read to no geometry, never a throw", () => {
    // "No geometry" is a check that could not conclude — verdict "plain".
    for (const body of [null, {}, { routes: [] }, { routes: [{}] }, { routes: [{ polyline: {} }] }]) {
      expect(parseComputeRoutesResponse(body)).toEqual([]);
    }
    expect(
      parseComputeRoutesResponse({
        routes: [{ polyline: { geoJsonLinestring: { type: "LineString", coordinates: [[1]] } } }],
      }),
    ).toEqual([]);
  });
});
