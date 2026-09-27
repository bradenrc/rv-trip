import { describe, it, expect } from "vitest";
import { savedPlaceCreate } from "../domain/types";
import type { PlaceSummary } from "../providers/index";
import {
  OFFLINE_NOTICE,
  captureFieldPlaceholder,
  captureRows,
  formatCoords,
  heardFromRecents,
  noteCaptureBody,
  noteRowSubline,
  noteRowTitle,
  pinCaptureBody,
  pinRowSubline,
  placeCaptureBody,
  placeRowSubline,
  queuedToast,
  savedToast,
  syncedToast,
} from "./sheet";

// docs/design/111 #100 — the sheet's rows, lines and toasts, verbatim.

const CHANDELIER: PlaceSummary = {
  googlePlaceId: "ChIJchandelier",
  name: "El Chandelier",
  location: { lat: 9.9329, lng: -84.0714 },
  rating: 4.6,
  address: "San José, Costa Rica",
  primaryType: "restaurant",
  primaryTypeDisplayName: "Restaurant",
};

describe("captureRows — one smart field", () => {
  it("online: an empty field shows only the pin row", () => {
    expect(captureRows("", true)).toEqual(["pin"]);
    expect(captureRows("   ", true)).toEqual(["pin"]);
  });

  it("online: Google rows, then the note, then the pin", () => {
    expect(captureRows("chandel", true)).toEqual(["places", "note", "pin"]);
  });

  it("offline: pin first when empty, note first when typed, search greyed last", () => {
    expect(captureRows("", false)).toEqual(["pin", "note", "search-off"]);
    expect(captureRows("chandel", false)).toEqual(["note", "pin", "search-off"]);
  });

  it("drops 'place' from the placeholder offline", () => {
    expect(captureFieldPlaceholder(true)).toBe("Place, note, or drop a pin");
    expect(captureFieldPlaceholder(false)).toBe("Note, or drop a pin");
  });
});

describe("the rows' lines", () => {
  it("names the note by what was typed", () => {
    expect(noteRowTitle("chandel")).toBe("Save “chandel” as a note");
    expect(noteRowTitle("")).toBe("Save as a note");
  });

  it("names the area by its town when online, and does not guess otherwise", () => {
    expect(noteRowSubline("San José, Costa Rica")).toBe("in San José area · where you are");
    expect(noteRowSubline(null)).toBe("in the area you're in");
  });

  it("draws the fix with a true minus, and says GPS offline", () => {
    expect(formatCoords(9.9325, -84.0521)).toBe("9.9325, −84.0521");
    expect(pinRowSubline({ lat: 9.9325, lng: -84.0521, accuracy: 12 }, true)).toBe("9.9325, −84.0521 · ±12 m");
    expect(pinRowSubline({ lat: 43.05, lng: -124.33, accuracy: 8.4 }, false)).toBe(
      "43.0500, −124.3300 · ±8 m GPS",
    );
  });

  it("gives a Google row one subline: type · address", () => {
    expect(placeRowSubline(CHANDELIER)).toBe("Restaurant · San José, Costa Rica");
    expect(placeRowSubline({ primaryTypeDisplayName: null, address: "Leggett, CA" })).toBe("Leggett, CA");
  });

  it("offers the account's distinct sources, newest first", () => {
    const saves = [{ source: "Marcy" }, { source: null }, { source: "Jane & Rick" }, { source: "marcy" }, { source: "Dana" }];
    expect(heardFromRecents(saves)).toEqual(["Marcy", "Jane & Rick", "Dana"]);
    expect(heardFromRecents(saves, 1)).toEqual(["Marcy"]);
  });
});

describe("the capture bodies — each one is a valid POST /api/places", () => {
  const want = { status: "want" as const, source: "Marcy", note: "" };

  it("a Google pick is a place save, typed from primaryType", () => {
    const body = placeCaptureBody(CHANDELIER, want);
    expect(body).toMatchObject({
      name: "El Chandelier",
      googlePlaceId: "ChIJchandelier",
      anchor: "place",
      type: "dining",
      source: "Marcy",
      note: null,
    });
    expect(savedPlaceCreate.safeParse({ ...body, clientId: "cap_1" }).success).toBe(true);
  });

  it("typed words are an AREA save at the phone's point, flagged when offline", () => {
    const body = noteCaptureBody(" chandel ", { lat: 43.0512, lng: -124.329 }, null, false, want);
    expect(body).toMatchObject({ name: "chandel", anchor: "area", capturedOffline: true, lat: 43.0512 });
    expect(savedPlaceCreate.safeParse(body).success).toBe(true);
  });

  it("a been save carries no source — the graduation rule", () => {
    expect(placeCaptureBody(CHANDELIER, { ...want, status: "been" }).source).toBeNull();
  });

  it("a pin is a pin save, named on the sub-screen", () => {
    const body = pinCaptureBody("great BLM camp spot", { lat: 43.05, lng: -124.33 }, "campground", false);
    expect(body).toMatchObject({ anchor: "pin", type: "campground", name: "great BLM camp spot" });
    expect(savedPlaceCreate.safeParse(body).success).toBe(true);
    expect(pinCaptureBody("", { lat: 43.05, lng: -124.33 }, "other", true).name).toBe("43.0500, −124.3300");
  });
});

describe("the toasts", () => {
  const dest = { id: "d", name: "San José, Costa Rica", region: "Costa Rica", googlePlaceId: "g", lat: null, lng: null };

  it("saved: the name, → the destination from the 201, and the shelf", () => {
    expect(
      savedToast({ place: { name: "El Chandelier", lat: null, lng: null, googlePlaceId: null }, destination: dest, status: "want" }),
    ).toEqual({ title: "Saved El Chandelier", sub: "→ San José, Costa Rica · Want to go" });
  });

  it("queued: amber, the count waiting", () => {
    expect(queuedToast(2)).toEqual({ title: "Saved on this phone", sub: "2 waiting for signal" });
  });

  it("synced: the count, and the first save that resolved", () => {
    const pin = { place: { name: "great BLM camp spot", lat: 43.05, lng: -124.33, googlePlaceId: null }, destination: { ...dest, name: "Bandon, OR" } };
    const note = { place: { name: "chandel", lat: null, lng: null, googlePlaceId: null }, destination: null };
    expect(syncedToast([note, pin])).toEqual({ title: "Synced 2 saves", sub: "great BLM camp spot → Bandon, OR" });
    expect(syncedToast([note])).toEqual({ title: "Synced 1 save", sub: null });
  });

  it("offline strip", () => {
    expect(OFFLINE_NOTICE).toEqual({
      title: "Offline. Saves wait on this phone.",
      sub: "Place search comes back with signal",
    });
  });
});
