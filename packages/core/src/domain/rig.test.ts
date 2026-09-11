import { describe, it, expect } from "vitest";
import {
  RIG_PRESETS,
  feetInchesToMeters,
  metersToFeetInches,
  poundsToKilograms,
  kilogramsToPounds,
  metersToVendorCm,
  kilogramsToVendorKg,
  rigProfileInput,
  rigHash,
  routingHash,
  NO_ROUTING_HASH,
  type RigProfileInput,
} from "./rig";

// The worked math from the wireframe (docs/design/9 §3). Every number here is
// the design's, verbatim — a rig reported one centimetre short is a rig routed
// under a bridge it does not clear, so these are safety assertions.

describe("imperial → metric, stored at millimetre precision", () => {
  it("11 ft 6 in stores as 3.5052 m", () => {
    expect(feetInchesToMeters(11, 6)).toBe(3.5052);
  });

  it("26 ft 0 in stores as 7.9248 m", () => {
    expect(feetInchesToMeters(26, 0)).toBe(7.9248);
  });

  it("8 ft 4 in stores as 2.54 m", () => {
    expect(feetInchesToMeters(8, 4)).toBe(2.54);
  });

  it("14,500 lb stores as 6577.09 kg", () => {
    expect(poundsToKilograms(14_500)).toBe(6577.09);
  });
});

describe("metric → imperial round-trip is lossless", () => {
  it("3.5052 m displays back as 11 ft 6 in", () => {
    expect(metersToFeetInches(3.5052)).toEqual({ feet: 11, inches: 6 });
  });

  it("7.9248 m displays back as 26 ft 0 in", () => {
    expect(metersToFeetInches(7.9248)).toEqual({ feet: 26, inches: 0 });
  });

  it("6577.09 kg displays back as 14,500 lb", () => {
    expect(kilogramsToPounds(6577.09)).toBe(14_500);
  });

  it("round-trips every whole inch from 8 to 14 feet", () => {
    for (let inch = 8 * 12; inch <= 14 * 12; inch++) {
      const m = feetInchesToMeters(0, inch);
      const back = metersToFeetInches(m);
      expect(back.feet * 12 + back.inches).toBe(inch);
    }
  });

  it("the trap: whole centimetres are what the vendor gets, never what we store", () => {
    const stored = feetInchesToMeters(11, 6);
    expect(stored).toBe(3.5052);
    expect(metersToVendorCm(stored) / 100).toBe(3.51);
    // 3.5052 m IS 138 in exactly. 3.51 m is 138.19 in — storing the rounded-up
    // centimetre would put a fifth of an inch of error into the number that
    // decides whether the rig clears a bridge.
    expect(stored / 0.0254).toBeCloseTo(138, 6);
    expect(3.51 / 0.0254).toBeCloseTo(138.19, 2);
  });
});

describe("vendor boundary always rounds UP", () => {
  it("3.5052 m → 351 cm", () => {
    expect(metersToVendorCm(3.5052)).toBe(351);
  });

  it("7.9248 m → 793 cm", () => {
    expect(metersToVendorCm(7.9248)).toBe(793);
  });

  it("2.54 m → 254 cm (already whole; never rounds down)", () => {
    expect(metersToVendorCm(2.54)).toBe(254);
  });

  it("6577.09 kg → 6578 kg", () => {
    expect(kilogramsToVendorKg(6577.09)).toBe(6578);
  });

  it("never reports the rig smaller than it is", () => {
    for (let mm = 3000; mm <= 4000; mm++) {
      const m = mm / 1000;
      expect(metersToVendorCm(m) / 100).toBeGreaterThanOrEqual(m);
    }
  });
});

describe("RIG_PRESETS", () => {
  it("offers the five classes the form renders, in order", () => {
    expect(RIG_PRESETS.map((p) => p.id)).toEqual([
      "class-a",
      "class-c",
      "travel-trailer",
      "fifth-wheel",
      "other",
    ]);
  });

  it("Class A and Class C are motorhomes; the towables are trailers", () => {
    const byId = Object.fromEntries(RIG_PRESETS.map((p) => [p.id, p]));
    expect(byId["class-a"]!.values?.type).toBe("motorhome");
    expect(byId["class-c"]!.values?.type).toBe("motorhome");
    expect(byId["travel-trailer"]!.values?.type).toBe("trailer");
    expect(byId["fifth-wheel"]!.values?.type).toBe("trailer");
  });

  it("'Something else' fills nothing — no values, no type", () => {
    const other = RIG_PRESETS.find((p) => p.id === "other")!;
    expect(other.values).toBeNull();
  });

  it("the Class C row is the issue's rig: 11'6\" · 26' · 14,500 lb", () => {
    const preset = RIG_PRESETS.find((p) => p.id === "class-c")!;
    expect(preset.label).toBe("Class C");
    expect(preset.description).toBe("11′6″ · 26′ · 14,500 lb");
    const c = preset.values!;
    expect(c.heightMeters).toBe(feetInchesToMeters(11, 6));
    expect(c.lengthMeters).toBe(feetInchesToMeters(26, 0));
    expect(c.grossWeightKg).toBe(poundsToKilograms(14_500));
  });

  it("'Something else' reads 'start blank'", () => {
    expect(RIG_PRESETS.find((p) => p.id === "other")!.description).toBe("start blank");
  });

  it("every filled preset validates against the domain schema", () => {
    for (const preset of RIG_PRESETS) {
      if (!preset.values) continue;
      expect(rigProfileInput.safeParse({ name: preset.label, ...preset.values }).success).toBe(
        true,
      );
    }
  });
});

describe("rigHash", () => {
  const rig = {
    name: "Sunseeker 2450",
    type: "motorhome" as const,
    heightMeters: 3.5052,
    widthMeters: 2.54,
    lengthMeters: 7.9248,
    grossWeightKg: 6577.09,
    propaneOnBoard: true,
  };

  it("is stable for the same rig", async () => {
    expect(await rigHash(rig)).toBe(await rigHash({ ...rig }));
  });

  /**
   * All SEVEN fields, one case each. A hole here is a SAFETY miss, not a cache
   * miss: correct your rig's width and a stale, non-RV-safe route would survive
   * the correction because nothing re-keyed. So the sweep is exhaustive by
   * construction — `edits` is typed to cover every key of the hashed rig.
   */
  const edits: { [K in keyof typeof rig]: RigProfileInput[K] } = {
    name: "Sunseeker 2500",
    type: "trailer",
    heightMeters: 3.5,
    widthMeters: 2.4384,
    lengthMeters: 8.2296,
    grossWeightKg: 6577.1,
    propaneOnBoard: false,
  };

  it.each(Object.keys(edits) as (keyof typeof rig)[])(
    "changes when %s changes",
    async (field) => {
      expect(await rigHash({ ...rig, [field]: edits[field] })).not.toBe(await rigHash(rig));
    },
  );

  it("has a distinct value for 'no rig yet'", async () => {
    expect(await rigHash(null)).toBe("no-rig");
  });
});

/**
 * The ROUTE key's rig half (docs/design/43 §1). rigHash above is rig IDENTITY
 * and keeps its seven-field sweep; this one keys every cached route, so the two
 * sweeps must disagree about exactly one field: `name`.
 */
describe("routingHash", () => {
  /** The six that key a route… */
  const routing = {
    type: "motorhome" as const,
    heightMeters: 3.5052,
    widthMeters: 2.54,
    lengthMeters: 7.9248,
    grossWeightKg: 6577.09,
    propaneOnBoard: true,
  };
  /** …and the seventh, which does not. */
  const rig = { name: "Sunseeker 2450", ...routing };

  it("is stable for the same rig", async () => {
    expect(await routingHash(routing)).toBe(await routingHash({ ...routing }));
  });

  /**
   * The whole point of Q1 = B: renaming the rig re-bills nothing. A route
   * between two coordinates under these six numbers is the same route whatever
   * the rig is called — so the name is not read, present or not.
   */
  it("is unchanged when only the rig's name changes", async () => {
    const renamed = { ...rig, name: "Sunseeker 2500" };
    expect(await routingHash(renamed)).toBe(await routingHash(rig));
    expect(await routingHash(rig)).toBe(await routingHash(routing));
  });

  /**
   * The SIX routing fields, one case each — exhaustive by construction, like
   * rigHash's sweep. A hole here is a SAFETY miss, not a cache miss: correct
   * your rig's width and a stale, non-RV-safe route would survive the
   * correction because nothing re-keyed.
   */
  const edits: { [K in keyof typeof routing]: RigProfileInput[K] } = {
    type: "trailer",
    heightMeters: 3.5,
    widthMeters: 2.4384,
    lengthMeters: 8.2296,
    grossWeightKg: 6577.1,
    propaneOnBoard: false,
  };

  it.each(Object.keys(edits) as (keyof typeof routing)[])(
    "changes when %s changes",
    async (field) => {
      expect(await routingHash({ ...routing, [field]: edits[field] })).not.toBe(
        await routingHash(routing),
      );
    },
  );

  it("has a distinct value for 'no rig yet', and it is the shipped sentinel", async () => {
    expect(await routingHash(null)).toBe(NO_ROUTING_HASH);
    expect(NO_ROUTING_HASH).toBe("no-rig");
  });

  /** Two different questions about one rig, so never the same answer. */
  it("is not rigHash", async () => {
    expect(await routingHash(rig)).not.toBe(await rigHash(rig));
  });
});
