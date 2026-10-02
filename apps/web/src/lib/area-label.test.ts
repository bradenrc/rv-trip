import { describe, expect, it } from "vitest";
import type { ResolvedArea } from "@rv-trip/core";
import { areaLabelNear } from "./area-label";

/**
 * #111 i4 · the web capture's area label (docs/design/111 "Web parity"): the
 * picker's escape row saves an area note, labelled with the locality the
 * browser is in — `/api/areas/resolve` — when geolocation is granted,
 * else null. The browser and the network are injected, so every branch runs
 * here without either.
 */
const BEND: ResolvedArea = {
  googlePlaceId: "ChIJ_bend",
  name: "Bend, OR",
  region: "Oregon",
  lat: 44.0582,
  lng: -121.3153,
};
const HERE = { lat: 44.06, lng: -121.31 };

describe("areaLabelNear", () => {
  it("names the locality the browser is in", async () => {
    let asked: { lat: number; lng: number } | null = null;
    const label = await areaLabelNear(
      async () => HERE,
      async (near) => {
        asked = near;
        return BEND;
      },
    );
    expect(label).toBe("Bend, OR");
    expect(asked).toEqual(HERE);
  });

  it("is null when geolocation is refused, and never asks the resolver", async () => {
    let called = false;
    const label = await areaLabelNear(
      async () => null,
      async () => {
        called = true;
        return BEND;
      },
    );
    expect(label).toBeNull();
    expect(called).toBe(false);
  });

  it("is null when the resolver names no locality (no key, nothing within 25 mi)", async () => {
    expect(await areaLabelNear(async () => HERE, async () => null)).toBeNull();
  });

  it("is null, not a thrown error, when either half fails", async () => {
    expect(
      await areaLabelNear(
        async () => {
          throw new Error("denied");
        },
        async () => BEND,
      ),
    ).toBeNull();
    expect(
      await areaLabelNear(
        async () => HERE,
        async () => {
          throw new Error("offline");
        },
      ),
    ).toBeNull();
  });
});
