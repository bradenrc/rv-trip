import { describe, expect, it } from "vitest";
import { stayClockLine } from "./stay-clock";

/** #162 · Q3 A — the Bellingham paste's two stays, in America/Los_Angeles
 * (DST ends Nov 1, so every offset is -08:00). */
const LA = "America/Los_Angeles";

describe("stayClockLine", () => {
  it("prints the Hyatt's line — 12-hour, in the row's own zone", () => {
    expect(
      stayClockLine({
        startsAt: "2026-11-11T16:00:00-08:00",
        startsTz: LA,
        endsAt: "2026-11-12T11:00:00-08:00",
        endsTz: LA,
      }),
    ).toBe("in after 4:00 PM · out by 11:00 AM");
  });

  it("reads a stored UTC instant back in the stay's zone, not the reader's", () => {
    // What Postgres hands back: the same instant, spelled in Z.
    expect(
      stayClockLine({ startsAt: "2026-11-12T23:00:00.000Z", startsTz: LA, endsAt: "2026-11-15T19:00:00.000Z", endsTz: LA }),
    ).toBe("in after 3:00 PM · out by 11:00 AM");
  });

  it("draws no line for a stay with no times", () => {
    expect(stayClockLine({ startsAt: null, startsTz: null, endsAt: null, endsTz: null })).toBeNull();
  });

  it("draws only the half it has", () => {
    expect(stayClockLine({ startsAt: "2026-11-11T16:30:00-08:00", startsTz: LA, endsAt: null, endsTz: null })).toBe(
      "in after 4:30 PM",
    );
    expect(stayClockLine({ startsAt: null, startsTz: null, endsAt: "2026-11-12T12:00:00-08:00", endsTz: LA })).toBe(
      "out by 12:00 PM",
    );
  });

  it("never carries ICU's narrow no-break space", () => {
    const line = stayClockLine({ startsAt: "2026-11-11T16:00:00-08:00", startsTz: LA, endsAt: null, endsTz: null })!;
    expect(line).not.toMatch(/ /);
  });
});

describe("routeModel carries the clock line and the byline onto a stay row (#162 vet MED)", () => {
  it("projects clock + lastChange; a non-stay row has no clock", async () => {
    const { pnwTrip } = await import("../seeds/index");
    const { routeModel } = await import("./index");
    const t = pnwTrip();
    const astoria = t.chapters[0]!.destinations[0]!;
    const [koa, museum] = astoria.reservations;
    const timed = {
      ...t,
      chapters: [
        {
          ...t.chapters[0]!,
          destinations: [
            {
              ...astoria,
              reservations: [
                { ...koa!, startsAt: "2026-08-02T15:00:00-07:00", startsTz: LA, lastChange: { field: "created" as const, memberName: "Braden", at: "2026-10-11T17:00:00Z" } },
                { ...museum!, startsAt: "2026-08-03T10:00:00-07:00", startsTz: LA },
              ],
            },
            ...t.chapters[0]!.destinations.slice(1),
          ],
        },
        ...t.chapters.slice(1),
      ],
    };
    const [row] = routeModel(timed)[0]!.rows;
    expect(row!.reservations[0]).toMatchObject({ clock: "in after 3:00 PM", lastChange: { field: "created", memberName: "Braden" } });
    expect(row!.reservations[1]!.clock).toBeNull();
  });
});
