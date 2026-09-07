import { describe, it, expect } from "vitest";
import {
  composeNoticeMessage,
  formatFeetInches,
  formatPounds,
  noticeKind,
  splitNoticeMessage,
} from "./notices";
import { feetInchesToMeters, poundsToKilograms } from "../domain/rig";

const RIG = {
  name: "Sunseeker 2450",
  type: "motorhome" as const,
  heightMeters: feetInchesToMeters(11, 6),
  widthMeters: feetInchesToMeters(8, 4),
  lengthMeters: feetInchesToMeters(26, 0),
  grossWeightKg: poundsToKilograms(14_500),
  propaneOnBoard: true,
};

describe("formatting", () => {
  it("keeps the inches even at zero", () => {
    expect(formatFeetInches(feetInchesToMeters(11, 0))).toBe("11′0″");
    expect(formatFeetInches(feetInchesToMeters(11, 6))).toBe("11′6″");
  });

  it("groups the pounds", () => {
    expect(formatPounds(poundsToKilograms(14_500))).toBe("14,500 lb");
  });
});

describe("noticeKind", () => {
  it("classifies the vendor codes the design shows", () => {
    expect(noticeKind("violatedVehicleRestriction", "height")).toBe("height");
    expect(noticeKind("hazmatRestriction")).toBe("propane");
  });

  it("classifies each dimension", () => {
    expect(noticeKind("violatedVehicleRestriction", "grossWeight")).toBe("weight");
    expect(noticeKind("violatedVehicleRestriction", "width")).toBe("width");
    expect(noticeKind("violatedVehicleRestriction", "length")).toBe("length");
  });

  it("keeps an unrecognised restriction rather than dropping it", () => {
    // A restriction we cannot classify is still a restriction.
    expect(noticeKind("somethingNewFromTheVendor")).toBe("other");
  });
});

describe("composeNoticeMessage", () => {
  it("writes the height notice the design specifies, verbatim", () => {
    expect(
      composeNoticeMessage({
        kind: "height",
        roadName: "US-12",
        limitMeters: feetInchesToMeters(11, 0),
        rig: RIG,
      }),
    ).toBe("Avoids the US-12 tunnel — 11′0″ clearance, your rig is 11′6″.");
  });

  it("writes the propane notice the design specifies, verbatim", () => {
    expect(
      composeNoticeMessage({ kind: "propane", roadName: "OR-22", limitMeters: null, rig: RIG }),
    ).toBe("Propane on board — the OR-22 tunnel is bypassed.");
  });

  it("puts the limit and your dimension in the same sentence for every dimension", () => {
    const width = composeNoticeMessage({
      kind: "width",
      roadName: "OR-138",
      limitMeters: feetInchesToMeters(8, 0),
      rig: RIG,
    });
    expect(width).toContain("8′0″");
    expect(width).toContain("8′4″");
  });

  it("names your weight when the vendor gives no distance limit", () => {
    expect(
      composeNoticeMessage({ kind: "weight", roadName: "OR-22", limitMeters: null, rig: RIG }),
    ).toBe("Avoids OR-22 — a weight limit your rig does not clear at 14,500 lb.");
  });

  it("still says something useful with no road name and no rig", () => {
    const msg = composeNoticeMessage({
      kind: "other",
      roadName: null,
      limitMeters: null,
      rig: null,
    });
    expect(msg).toBe("A restriction on this route affects your rig.");
  });
});

describe("splitNoticeMessage", () => {
  it("sets the road, the limit and your dimension in mono", () => {
    expect(
      splitNoticeMessage("Avoids the US-12 tunnel — 11′0″ clearance, your rig is 11′6″."),
    ).toEqual([
      { text: "Avoids the ", mono: false },
      { text: "US-12", mono: true },
      { text: " tunnel — ", mono: false },
      { text: "11′0″", mono: true },
      { text: " clearance, your rig is ", mono: false },
      { text: "11′6″", mono: true },
      { text: ".", mono: false },
    ]);
  });

  it("sets a weight in mono too", () => {
    const segments = splitNoticeMessage(
      "Avoids OR-22 — a weight limit your rig does not clear at 14,500 lb.",
    );
    expect(segments.filter((s) => s.mono).map((s) => s.text)).toEqual(["OR-22", "14,500 lb"]);
  });

  it("rejoins to exactly the original message", () => {
    const message = "Propane on board — the OR-22 tunnel is bypassed.";
    expect(splitNoticeMessage(message).map((s) => s.text).join("")).toBe(message);
  });

  it("returns one plain run when there is nothing to highlight", () => {
    expect(splitNoticeMessage("A restriction on this route affects your rig.")).toEqual([
      { text: "A restriction on this route affects your rig.", mono: false },
    ]);
  });
});
