import { describe, expect, it } from "vitest";
import type { PlaceSummary } from "./index";
import type { PlacesEnvelope } from "./places-search";
import {
  PICKER_DEBOUNCE_MS,
  PICKER_DEGRADED_MESSAGE,
  PICKER_ESCAPE_BLURB,
  PICKER_PLACEHOLDER,
  PICKED_COORDLESS_LABEL,
  escapeRowLabel,
  initialHighlight,
  moveHighlight,
  pickedCoordLabel,
  pickedFromFreeText,
  pickedFromSummary,
  pickerView,
  type PickedPlace,
} from "./place-picker";

/**
 * The picker's whole state machine — docs/design/41 §4, states 1-7.
 *
 * `apps/web` ships no test runner (packages/core is the only workspace with a
 * `test` script), so the seven states are pinned HERE, on the pure view-model
 * the component renders. Every decision the picker makes — which rows exist,
 * what the status line reads, what a chosen row emits, where the highlight
 * starts and how it moves — is in this module and covered below. What is NOT
 * covered by an executing test is the JSX that paints these rows and the
 * debounce timer that drives them; see docs/design/41/dev-notes.md.
 */

const KALALOCH: PlaceSummary = {
  googlePlaceId: "ChIJvT2R2rSjkFQRRJgVJZ2Xk1Q",
  name: "Kalaloch Campground",
  location: { lat: 47.6118, lng: -124.3762 },
  rating: 4.4,
  address: "156954 US-101, Forks, WA 98331",
};

const LODGE: PlaceSummary = {
  googlePlaceId: "ChIJC9xY0LWjkFQRk1cW6r0KJ7A",
  name: "Kalaloch Lodge",
  location: { lat: 47.61, lng: -124.3745 },
  rating: 4.1,
  address: "157151 US-101, Forks, WA 98331",
};

const healthy = (results: PlaceSummary[]): PlacesEnvelope => ({ results, degraded: false });

describe("state 1 · idle", () => {
  it("is idle with an empty box and nothing picked", () => {
    const view = pickerView({ value: null, query: "", envelope: null, pending: false });
    expect(view.state).toBe("idle");
    if (view.state !== "idle") return;
    expect(view.placeholder).toBe(PICKER_PLACEHOLDER);
  });

  it("is still idle when the box holds only whitespace", () => {
    const view = pickerView({ value: null, query: "   ", envelope: null, pending: true });
    expect(view.state).toBe("idle");
  });

  it("takes the caller's placeholder when it is given one", () => {
    const view = pickerView({
      value: null,
      query: "",
      envelope: null,
      pending: false,
      placeholder: "Where are you starting?",
    });
    expect(view.state === "idle" && view.placeholder).toBe("Where are you starting?");
  });
});

describe("state 2 · typing, below the debounce threshold", () => {
  it("shows the waiting status and no list at all", () => {
    const view = pickerView({ value: null, query: "kal", envelope: null, pending: true });
    expect(view.state).toBe("typing");
    if (view.state !== "typing") return;
    expect(view.status).toBe("waiting · 250 ms");
  });

  it("names the real debounce constant in its status", () => {
    expect(PICKER_DEBOUNCE_MS).toBe(250);
    const view = pickerView({ value: null, query: "kal", envelope: null, pending: true });
    expect(view.state === "typing" && view.status).toContain(String(PICKER_DEBOUNCE_MS));
  });
});

describe("state 3 · results, the healthy path", () => {
  const view = pickerView({
    value: null,
    query: "kalaloch",
    envelope: healthy([KALALOCH, LODGE]),
    pending: false,
  });

  it("lists both results and pins the escape row last", () => {
    expect(view.state).toBe("list");
    if (view.state !== "list") return;
    expect(view.rows.map((r) => r.kind)).toEqual(["result", "result", "escape"]);
    expect(view.rows[0]!.name).toBe("Kalaloch Campground");
    expect(view.rows[0]!.detail).toBe("156954 US-101, Forks, WA 98331");
    expect(view.rows[0]!.rating).toBe(4.4);
    expect(view.rows[1]!.name).toBe("Kalaloch Lodge");
  });

  it("counts the results in the status line and shows no warning", () => {
    if (view.state !== "list") return;
    expect(view.status).toBe("2 results");
    expect(view.degradedMessage).toBeNull();
  });

  it("says '1 result' for one", () => {
    const one = pickerView({
      value: null,
      query: "kalaloch",
      envelope: healthy([KALALOCH]),
      pending: false,
    });
    expect(one.state === "list" && one.status).toBe("1 result");
  });

  it("emits the whole PlaceSummary when a result row is chosen", () => {
    if (view.state !== "list") return;
    expect(view.rows[0]!.picked).toEqual({
      name: "Kalaloch Campground",
      lat: 47.6118,
      lng: -124.3762,
      googlePlaceId: "ChIJvT2R2rSjkFQRRJgVJZ2Xk1Q",
      address: "156954 US-101, Forks, WA 98331",
      rating: 4.4,
    });
  });

  it("keeps a coordless Google row pickable, with a null lat/lng", () => {
    const coordless: PlaceSummary = { ...KALALOCH, location: null, rating: null, address: null };
    const v = pickerView({
      value: null,
      query: "kalaloch",
      envelope: healthy([coordless]),
      pending: false,
    });
    if (v.state !== "list") return;
    expect(v.rows[0]!.picked).toEqual({
      name: "Kalaloch Campground",
      lat: null,
      lng: null,
      googlePlaceId: "ChIJvT2R2rSjkFQRRJgVJZ2Xk1Q",
      address: null,
      rating: null,
    });
  });

  it("highlights the first row when the answer is a real one", () => {
    if (view.state !== "list") return;
    expect(view.highlight).toBe(0);
    expect(initialHighlight(healthy([KALALOCH, LODGE]))).toBe(0);
  });

  it("prefers a fresh envelope over a stale pending flag", () => {
    const v = pickerView({
      value: null,
      query: "kalaloch",
      envelope: healthy([KALALOCH]),
      pending: true,
    });
    expect(v.state).toBe("typing");
  });
});

describe("state 4 · no matches — Google answered, and had nothing", () => {
  const view = pickerView({
    value: null,
    query: "forest road 25 pullout",
    envelope: healthy([]),
    pending: false,
  });

  it("renders the escape row as the only row, already highlighted", () => {
    expect(view.state).toBe("list");
    if (view.state !== "list") return;
    expect(view.rows.map((r) => r.kind)).toEqual(["escape"]);
    expect(view.highlight).toBe(0);
  });

  it("still counts honestly and shows no warning — an empty answer is an answer", () => {
    if (view.state !== "list") return;
    expect(view.status).toBe("0 results");
    expect(view.degradedMessage).toBeNull();
  });
});

describe("state 5 · degraded — no key, upstream error, or throttled", () => {
  const reasons = ["no_provider", "upstream_error", "rate_limited"] as const;

  for (const reason of reasons) {
    const envelope: PlacesEnvelope = { results: [], degraded: true, reason };
    const view = pickerView({ value: null, query: "kalaloch", envelope, pending: false });

    it(`shows the escape row and the warning for ${reason}`, () => {
      expect(view.state).toBe("list");
      if (view.state !== "list") return;
      expect(view.rows.map((r) => r.kind)).toEqual(["escape"]);
      expect(view.degradedMessage).toBe(PICKER_DEGRADED_MESSAGE);
    });

    it(`drops the result count and the auto-highlight for ${reason}`, () => {
      if (view.state !== "list") return;
      // "0 results" would be a lie: nobody counted anything.
      expect(view.status).toBeNull();
      expect(view.highlight).toBe(-1);
      expect(initialHighlight(envelope)).toBe(-1);
    });
  }

  it("uses one warning line for all three reasons", () => {
    expect(PICKER_DEGRADED_MESSAGE).toBe(
      "Place search is unavailable right now — you can still type a name and save.",
    );
  });
});

describe("the escape row — pinned to the bottom of EVERY list state", () => {
  const lists: [string, PlacesEnvelope][] = [
    ["results", healthy([KALALOCH, LODGE])],
    ["no matches", healthy([])],
    ["degraded", { results: [], degraded: true, reason: "no_provider" }],
  ];

  for (const [label, envelope] of lists) {
    it(`is the last row in the ${label} state`, () => {
      const view = pickerView({ value: null, query: "kalaloch", envelope, pending: false });
      expect(view.state).toBe("list");
      if (view.state !== "list") return;
      expect(view.rows.at(-1)?.kind).toBe("escape");
    });
  }

  it("reads back the query verbatim, in the design's copy", () => {
    const view = pickerView({
      value: null,
      query: "kalaloch",
      envelope: healthy([]),
      pending: false,
    });
    if (view.state !== "list") return;
    expect(view.rows[0]!.name).toBe("Use “kalaloch” as a plain name");
    expect(view.rows[0]!.detail).toBe("No coordinates — add them later from the map");
    expect(PICKER_ESCAPE_BLURB).toBe("No coordinates — add them later from the map");
    expect(escapeRowLabel("  forest road 25 pullout  ")).toBe(
      "Use “forest road 25 pullout” as a plain name",
    );
  });

  it("emits a PickedPlace with lat, lng and googlePlaceId ALL null", () => {
    for (const [, envelope] of lists) {
      const view = pickerView({ value: null, query: "  Kalaloch  ", envelope, pending: false });
      if (view.state !== "list") return;
      const escape = view.rows.at(-1);
      expect(escape?.picked).toEqual({
        name: "Kalaloch",
        lat: null,
        lng: null,
        googlePlaceId: null,
        address: null,
        rating: null,
      });
    }
  });

  it("carries no rating, so nothing renders a star on it", () => {
    const view = pickerView({
      value: null,
      query: "kalaloch",
      envelope: healthy([]),
      pending: false,
    });
    expect(view.state === "list" && view.rows[0]!.rating).toBeNull();
  });

  it("pickedFromFreeText trims and nulls everything else", () => {
    expect(pickedFromFreeText("\tForest Road 25 pullout \n")).toEqual({
      name: "Forest Road 25 pullout",
      lat: null,
      lng: null,
      googlePlaceId: null,
      address: null,
      rating: null,
    });
  });

  it("pickedFromSummary is the PlaceSummary → PickedPlace map", () => {
    expect(pickedFromSummary(LODGE)).toEqual({
      name: "Kalaloch Lodge",
      lat: 47.61,
      lng: -124.3745,
      googlePlaceId: "ChIJC9xY0LWjkFQRk1cW6r0KJ7A",
      address: "157151 US-101, Forks, WA 98331",
      rating: 4.1,
    });
  });
});

describe("state 6 · picked from Google", () => {
  const picked = pickedFromSummary(KALALOCH);

  it("wins over whatever is in the box", () => {
    const view = pickerView({
      value: picked,
      query: "something else",
      envelope: healthy([LODGE]),
      pending: true,
    });
    expect(view.state).toBe("picked");
    if (view.state !== "picked") return;
    expect(view.picked).toEqual(picked);
    expect(view.mapped).toBe(true);
  });

  it("reads the coordinates and the truncated place id", () => {
    expect(pickedCoordLabel(picked)).toBe("47.6118, −124.3762 · ChIJvT2R…");
  });

  it("drops the id clause when a Google row had no id to show", () => {
    const noId: PickedPlace = { ...picked, googlePlaceId: null };
    expect(pickedCoordLabel(noId)).toBe("47.6118, −124.3762");
  });
});

describe("state 7 · picked via the escape — a legal, coordless row", () => {
  const picked = pickedFromFreeText("Forest Road 25 pullout");

  it("is picked, and says so is not on the map yet", () => {
    const view = pickerView({ value: picked, query: "", envelope: null, pending: false });
    expect(view.state).toBe("picked");
    if (view.state !== "picked") return;
    expect(view.mapped).toBe(false);
    expect(view.coordLabel).toBe(PICKED_COORDLESS_LABEL);
  });

  it("uses the design's exact coordless copy", () => {
    expect(PICKED_COORDLESS_LABEL).toBe("No coordinates — won’t appear on the map yet");
    expect(pickedCoordLabel(picked)).toBe(PICKED_COORDLESS_LABEL);
  });

  it("is coordless when only half a coordinate survived", () => {
    expect(pickedCoordLabel({ ...picked, lat: 47.6118 })).toBe(PICKED_COORDLESS_LABEL);
  });
});

describe("keyboard navigation of the result list", () => {
  it("steps down and wraps around the end", () => {
    expect(moveHighlight(-1, 3, 1)).toBe(0);
    expect(moveHighlight(0, 3, 1)).toBe(1);
    expect(moveHighlight(2, 3, 1)).toBe(0);
  });

  it("steps up from nothing to the escape row at the bottom", () => {
    expect(moveHighlight(-1, 3, -1)).toBe(2);
    expect(moveHighlight(0, 3, -1)).toBe(2);
    expect(moveHighlight(2, 3, -1)).toBe(1);
  });

  it("has nowhere to go in an empty list", () => {
    expect(moveHighlight(-1, 0, 1)).toBe(-1);
    expect(moveHighlight(-1, 0, -1)).toBe(-1);
  });
});
