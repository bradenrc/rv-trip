import { describe, expect, it, vi } from "vitest";
import type { ResolvedDestination } from "@rv-trip/core";
import { GET } from "@/app/api/destinations/resolve/route";

const resolver = vi.hoisted(() => ({
  calls: [] as [number, number][],
  answer: null as ResolvedDestination | null | "throw",
}));
vi.mock("@/lib/places", () => ({
  placesProvider: () => ({
    configured: true,
    provider: {
      search: async () => [],
      details: async () => null,
      resolveDestination: async (lat: number, lng: number) => {
        resolver.calls.push([lat, lng]);
        if (resolver.answer === "throw") throw new Error("Google geocode → REQUEST_DENIED");
        return resolver.answer;
      },
    },
  }),
}));

const SAN_JOSE: ResolvedDestination = {
  googlePlaceId: "ChIJsanjose",
  name: "San José, Costa Rica",
  region: "Costa Rica",
  lat: 9.9281,
  lng: -84.0907,
};

const get = (qs: string) => GET(new Request(`http://test.local/api/destinations/resolve${qs}`));

/** No database: the route writes nothing — the row is upserted only on save. */
describe("GET /api/destinations/resolve (#111)", () => {
  it("answers the locality for ?near=lat,lng", async () => {
    resolver.calls = [];
    resolver.answer = SAN_JOSE;
    const res = await get("?near=9.9325,-84.0521");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SAN_JOSE);
    expect(resolver.calls).toEqual([[9.9325, -84.0521]]);
  });

  it("answers null when there is no locality, and when Google fails", async () => {
    resolver.answer = null;
    expect(await (await get("?near=42.53,-118.53")).json()).toBeNull();
    resolver.answer = "throw";
    const res = await get("?near=42.53,-118.53");
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("400s a missing or malformed near", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get("?near=somewhere")).status).toBe(400);
  });
});
