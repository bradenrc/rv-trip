import { expect, it } from "vitest";
import { tripSummaryListSchema } from "@rv-trip/core/api-client";
import { fx } from "@rv-trip/db/testing";
import { GET } from "@/app/api/trips/route";
import { describeDb } from "@/test/db";

/**
 * §6 the four derivation cases, from the same pinned clock — the cheapest way
 * to prove `deriveTripStatus` at the handler level. `today` is "2026-08-15" in
 * every timezone, because `todayIso()` slices `toISOString()`.
 */
describeDb("GET /api/trips — derived status", () => {
  it("derives every row's status from the pinned clock", async () => {
    // endDate >= today, and daysUntil(start) = -14 <= 30 — the window test is
    // a one-sided <=, so a trip already under way reads "upcoming".
    const underway = await fx.trip({
      title: "Pacific Northwest Loop",
      startDate: "2026-08-01",
      endDate: "2026-08-28",
    });
    // endDate < today — the first branch.
    const ended = await fx.trip({
      title: "June shakedown",
      startDate: "2026-06-01",
      endDate: "2026-06-20",
    });
    // daysUntil(start) = 47 > UPCOMING_WINDOW_DAYS (30).
    const far = await fx.trip({
      title: "October canyons",
      startDate: "2026-10-01",
      endDate: "2026-10-20",
    });
    // The pin wins outright — this is what seed.ts:24 does to keep the demo
    // trip live.
    const pinned = await fx.trip({
      title: "Pinned demo",
      startDate: "2026-06-01",
      endDate: "2026-06-20",
      status: "planning",
      statusAuto: false,
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const rows = tripSummaryListSchema.parse(await res.json());
    const status = new Map(rows.map((r) => [r.id, r.status]));

    expect(status.get(underway.id)).toBe("upcoming");
    expect(status.get(ended.id)).toBe("complete");
    expect(status.get(far.id)).toBe("planning");
    expect(status.get(pinned.id)).toBe("planning");
  });
});
