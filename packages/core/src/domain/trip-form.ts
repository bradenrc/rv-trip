import { pickedFromPlace, type PickedPlace } from "../providers/place-picker";
import { homeBasePatch } from "./place-form";
import {
  isoDate,
  tripCreateInput,
  type IsoDate,
  type Leg,
  type LodgingKind,
  type Place,
  type Stop,
  type StopPatchInput,
  type Trip,
  type TripCreateInput,
  type TripPatchInput,
  type TripStatus,
  type TravelMode,
} from "./types";
import { daysUntil, formatDateSpan } from "./trip-status";

/**
 * The two trip forms, as pure functions of what the user typed.
 *
 * The dialog and the create page are React; what they DECIDE is not. Both of
 * them turn a set of fields into a request body, and both have a rule worth
 * pinning: the create page refuses a backwards range, and the settings dialog
 * sends only what changed — an omitted key is a field left alone
 * (`tripPatchInput` is `.partial()`, so a sent `undefined` would be a phantom
 * reset). That decision lives here, where it executes under `vitest`.
 */

/** Trip length in days, counting both ends. `null` when the range is unusable. */
export function tripDayCount(start: string, end: string): number | null {
  if (!isoDate.safeParse(start).success || !isoDate.safeParse(end).success) return null;
  const days = daysUntil(end as IsoDate, start as IsoDate) + 1;
  return days > 0 ? days : null;
}

// ── /trips/new ─────────────────────────────────────────────────────────────

// ── #103 · the setup's three questions ─────────────────────────────────────

/**
 * How the trip mostly moves — the answer to question 1. Three cards, two
 * stored values: "A mix" is stored as `fly` (Q2 A, the Greece seed's own
 * answer), so reopening it in Trip settings reads "Fly & stay".
 */
export type TripModeChoice = "road" | "air" | "mixed";

/** The three cards, with the design's copy — shared by the web page and the
 * phone screen so the two never drift. */
export const TRIP_MODE_CHOICES: readonly { value: TripModeChoice; label: string; sub: string }[] = [
  { value: "road", label: "Road trip", sub: "Driving between stops. Camping, RV, or car." },
  { value: "air", label: "Fly & stay", sub: "Fly there, stay put or fly between stops." },
  { value: "mixed", label: "A mix", sub: "Flights, ferries, and drives. You set each hop." },
];

/** Question 2's cards. The ORDER follows the mode (see `lodgingChoices`). */
export const LODGING_CHOICE_LABEL: Record<LodgingKind, string> = {
  campground: "Campgrounds",
  hotel: "Hotels",
  airbnb: "Airbnbs",
  friends: "With friends",
};

/** Question 3 — only a road trip is asked. `sub` is what the card promises. */
export const RIG_CHOICES: readonly { value: boolean; label: string; sub: string }[] = [
  { value: true, label: "Yes, the rig comes", sub: "Routes are checked against its size." },
  // HERE is always asked for a truck-profile route; with no rig it simply
  // carries no dimensions (providers/here.ts). The design's "Ordinary car
  // routing." promised a car profile the code does not send (vet MED), so the
  // card says what is true.
  { value: false, label: "No, just the car", sub: "Routes aren't checked against a rig." },
];

/** The stored default a mode card writes. */
export function tripModeDefault(choice: TripModeChoice): TravelMode {
  return choice === "road" ? "drive" : "fly";
}

/** The card a stored default reopens on — "A mix" cannot be told from "Fly &
 * stay" once stored (Q2 A), so every fly/ferry default reads "Fly & stay". */
export function tripModeChoice(mode: TravelMode): TripModeChoice {
  return mode === "drive" ? "road" : "air";
}

/** Question 2's cards, ordered by mode: campgrounds lead a road trip, hotels
 * lead everything else. */
export function lodgingChoices(choice: TripModeChoice | null): LodgingKind[] {
  return choice === "road"
    ? ["campground", "hotel", "airbnb", "friends"]
    : ["hotel", "airbnb", "friends", "campground"];
}

/**
 * What the create form holds. The dates and the title are strings, the way an
 * input holds them; home base is the PlacePicker's value (#60 Q4 → B) — the
 * free-text field is gone, so a home base is either a whole place or nothing.
 * `mode` is null until question 1 is answered, which is what keeps the rest of
 * the page (and Create) hidden.
 */
export interface TripDraft {
  title: string;
  startDate: string;
  endDate: string;
  /** #126 · Q4 A — "Where to?", the question the page now opens on. A place
   * with a Google id becomes the trip's destination and its spanning stop. */
  destination?: PickedPlace | null;
  /** The trip's OWN home base — an override. Null reads the household
   * default (#126 · Q5 A), which the page shows as a quiet chip. */
  homeBasePlace: PickedPlace | null;
  mode: TripModeChoice | null;
  lodgingDefault: LodgingKind | null;
  rigOn: boolean;
}

export const BLANK_TRIP_DRAFT: TripDraft = {
  title: "",
  startDate: "",
  endDate: "",
  destination: null,
  homeBasePlace: null,
  mode: null,
  lodgingDefault: null,
  rigOn: false,
};

/**
 * A mode card pressed. It preselects the lodging a trip like that mostly uses
 * (campgrounds for a road trip, hotels otherwise) and, for a road trip, "Yes,
 * the rig comes" — defaults, so the next two questions are one tap or none.
 */
export function withTripMode(draft: TripDraft, mode: TripModeChoice): TripDraft {
  return {
    ...draft,
    mode,
    lodgingDefault: mode === "road" ? "campground" : "hotel",
    rigOn: mode === "road",
  };
}

/**
 * The `POST /api/trips` body, or `null` while the form is not submittable —
 * which is also what disables the Create button, so there is one rule, not two.
 * No mode picked is not submittable: the mode is the question the page opens on.
 */
export function tripDraftInput(draft: TripDraft): TripCreateInput | null {
  if (draft.mode === null) return null;
  if (tripDayCount(draft.startDate, draft.endDate) === null) return null;
  const dest = draft.destination ?? null;
  const parsed = tripCreateInput.safeParse({
    // An untitled trip to a picked place is named for it ("Bellingham, WA").
    title: draft.title.trim() || dest?.name.trim() || "",
    // Only a real Google place can be a destinations row (the unique is owner
    // + place id); a free-text escape pick names the trip, nothing more.
    ...(dest?.googlePlaceId && {
      destination: { googlePlaceId: dest.googlePlaceId, name: dest.name, lat: dest.lat, lng: dest.lng },
    }),
    startDate: draft.startDate,
    endDate: draft.endDate,
    // `homeBase` (the name) and `homeBasePlace` (the anchor) travel together so
    // the two can never disagree — a cleared picker clears both.
    ...homeBasePatch(draft.homeBasePlace),
    defaultMode: tripModeDefault(draft.mode),
    lodgingDefault: draft.lodgingDefault,
    // A fly trip or a mix is never asked about the rig — its answer is off.
    rigOn: draft.mode === "road" ? draft.rigOn : false,
  });
  return parsed.success ? parsed.data : null;
}

// ── the trip settings dialog ───────────────────────────────────────────────

/** "Automatic" (let the dates decide) or a status the human pinned. */
export type TripStatusChoice = "auto" | TripStatus;

/** What the settings dialog holds. `rating` is 0 for unrated, the way `Stars`
 * renders it; `note` is "" for null, the way an input holds it; home base is
 * the PlacePicker's value, seeded from the trip's stored place. */
export interface TripSettingsDraft {
  startDate: string;
  endDate: string;
  homeBasePlace: PickedPlace | null;
  status: TripStatusChoice;
  rating: number;
  note: string;
  /** #103 · the three defaults (klunk row 7). A stored `fly` reads "Fly & stay". */
  mode: TripModeChoice;
  lodgingDefault: LodgingKind | null;
  rigOn: boolean;
}

/** A pre-#60 trip's bare `home_base` string, as a coordless place — so the
 * picker opens on the name that is there rather than on an empty box. */
function placeFromName(name: string | null): Place | null {
  return name === null ? null : { name, lat: null, lng: null, googlePlaceId: null };
}

function samePlace(a: Place | null, b: Place | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.name === b.name &&
    a.lat === b.lat &&
    a.lng === b.lng &&
    a.googlePlaceId === b.googlePlaceId
  );
}

/** The trip, as the dialog's opening state. */
export function tripSettingsDraft(t: Trip): TripSettingsDraft {
  return {
    startDate: t.startDate,
    endDate: t.endDate,
    // A pre-#60 trip has a name and no anchor; the picker still opens on the
    // name it has, so re-picking is the way it gains coordinates.
    homeBasePlace: pickedFromPlace(t.homeBasePlace ?? placeFromName(t.homeBase)),
    status: t.statusAuto ? "auto" : t.status,
    rating: t.rating ?? 0,
    note: t.note ?? "",
    mode: tripModeChoice(t.defaultMode),
    lodgingDefault: t.lodgingDefault,
    rigOn: t.rigOn,
  };
}

/**
 * The three defaults alone, as a PATCH — what the phone's "Trip defaults"
 * sheet saves and what the web dialog folds into its patch. Only what changed;
 * a mode that leaves the road turns the rig off with it (a fly trip never
 * brings the rig), and a road trip keeps whatever the rig answer is.
 */
export function tripDefaultsPatch(
  t: Pick<Trip, "defaultMode" | "lodgingDefault" | "rigOn">,
  d: { mode: TripModeChoice; lodgingDefault: LodgingKind | null; rigOn: boolean },
): TripPatchInput {
  const patch: TripPatchInput = {};
  const mode = tripModeDefault(d.mode);
  // "A mix" and "Fly & stay" store the same `fly`; switching between the two
  // is not a change.
  if (mode !== t.defaultMode) patch.defaultMode = mode;
  if (d.lodgingDefault !== t.lodgingDefault) patch.lodgingDefault = d.lodgingDefault;
  const rigOn = d.mode === "road" ? d.rigOn : false;
  if (rigOn !== t.rigOn) patch.rigOn = rigOn;
  return patch;
}

/**
 * The `PATCH /api/trips/:id` body: the keys that actually differ from the trip
 * on screen, and nothing else.
 *
 * Status is the one pair. Choosing a status pins it, so `status` and
 * `statusAuto: false` travel together; choosing Automatic sends `statusAuto`
 * alone and leaves the stored `status` where it is — the derivation ignores it
 * from then on.
 */
export function tripSettingsPatch(t: Trip, d: TripSettingsDraft): TripSettingsPatch {
  const patch: TripSettingsPatch = rangeAndHomePatch(t, d);

  const note = d.note.trim() === "" ? null : d.note;
  if (note !== t.note) patch.note = note;

  const rating = d.rating === 0 ? null : d.rating;
  if (rating !== t.rating) patch.rating = rating;

  if (d.status === "auto") {
    if (!t.statusAuto) patch.statusAuto = true;
  } else if (t.statusAuto || d.status !== t.status) {
    patch.status = d.status;
    patch.statusAuto = false;
  }

  Object.assign(patch, tripDefaultsPatch(t, d));

  return patch;
}

/** The web dialog's patch — it never edits the destination (#143 added that
 * to the phone's Trip settings only), so the key is not in its type. */
export type TripSettingsPatch = Omit<TripPatchInput, "destination">;

/** The dates + "Starts from" half of a settings patch — shared by the web
 * dialog and the phone's Trip settings (#143) so the two rules cannot drift. */
function rangeAndHomePatch(
  t: Trip,
  d: Pick<TripSettingsDraft, "startDate" | "endDate" | "homeBasePlace">,
): TripSettingsPatch {
  const patch: TripSettingsPatch = {};

  // A backwards or half-typed range is never sent; the dialog disables Save on
  // it, and dropping it here means a bad date can't ride along with a good note.
  if (tripDayCount(d.startDate, d.endDate) !== null) {
    if (d.startDate !== t.startDate) patch.startDate = d.startDate;
    if (d.endDate !== t.endDate) patch.endDate = d.endDate;
  }

  // Home base is one decision, sent as the pair it is stored as: an unchanged
  // name AND an unchanged anchor is the only "nothing moved".
  const home = homeBasePatch(d.homeBasePlace);
  // Compared against the same value the dialog OPENED on — a pre-#60 trip with
  // a name and no anchor must not read as "changed" the moment the dialog
  // renders, and re-picking that same name WITH coordinates must.
  const current = t.homeBasePlace ?? placeFromName(t.homeBase);
  if (home.homeBase !== t.homeBase || !samePlace(home.homeBasePlace ?? null, current)) {
    patch.homeBase = home.homeBase;
    patch.homeBasePlace = home.homeBasePlace;
  }

  return patch;
}

// ── #143 · Q8 A — the phone's Trip settings ────────────────────────────────

/**
 * What the phone's "Trip settings" screen holds: Destination · Dates · Starts
 * from above the three defaults. Status, rating and note stay web-only, so
 * they are not in it and can never ride along on its Save.
 */
export interface PhoneTripSettingsDraft
  extends Pick<
    TripSettingsDraft,
    "startDate" | "endDate" | "homeBasePlace" | "mode" | "lodgingDefault" | "rigOn"
  > {
  /** "Where to?" — a place picked from the search, or null for none. */
  destination: PickedPlace | null;
}

/** The trip, as the phone screen's opening state. */
export function phoneTripSettingsDraft(t: Trip): PhoneTripSettingsDraft {
  const { startDate, endDate, homeBasePlace, mode, lodgingDefault, rigOn } = tripSettingsDraft(t);
  const dest = t.destination ?? null;
  return {
    startDate,
    endDate,
    homeBasePlace,
    mode,
    lodgingDefault,
    rigOn,
    destination: dest
      ? {
          name: dest.name,
          lat: dest.lat,
          lng: dest.lng,
          googlePlaceId: dest.googlePlaceId,
          address: null,
          rating: null,
          primaryType: null,
        }
      : null,
  };
}

/**
 * The phone's Save — only what changed. A new destination is sent as the
 * picked place (the server upserts the household's row and repoints the trip;
 * no stop is written); null clears it. A pick with no Google id cannot be a
 * destinations row, so it is not a change. "Use household default" is a null
 * home base, exactly as on the web.
 */
export function phoneTripSettingsPatch(t: Trip, d: PhoneTripSettingsDraft): TripPatchInput {
  const patch: TripPatchInput = rangeAndHomePatch(t, d);
  const current = t.destination ?? null;
  if (d.destination === null) {
    if (current !== null) patch.destination = null;
  } else if (d.destination.googlePlaceId && d.destination.googlePlaceId !== current?.googlePlaceId) {
    const { name, googlePlaceId, lat, lng } = d.destination;
    patch.destination = { name, googlePlaceId, lat, lng };
  }
  Object.assign(patch, tripDefaultsPatch(t, d));
  return patch;
}

// ── the delete confirm ─────────────────────────────────────────────────────

/** What a cascading delete takes with it. The client holds the whole tree, so
 * the confirm counts before it opens — never "are you sure?", always the
 * number that is about to go. */
export interface CascadeCounts {
  legs: number;
  stops: number;
  reservations: number;
  ideas: number;
}

/** Everything a `DELETE /api/trips/:id` cascades away (schema.ts FKs). */
export function tripCascadeCounts(t: Trip): CascadeCounts {
  const stops = t.legs.flatMap((l) => l.stops);
  return {
    legs: t.legs.length,
    stops: stops.length,
    reservations: stops.reduce((n, s) => n + s.reservations.length, 0),
    ideas: stops.reduce((n, s) => n + s.ideas.length, 0),
  };
}

function countPhrase(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** "Its 2 legs, 2 stops, 3 reservations and 2 ideas are deleted with it. This
 * can't be undone." — zero counts are left out rather than read as "0 ideas". */
export function cascadeLossSentence(c: CascadeCounts): string {
  const parts = [
    c.legs > 0 ? countPhrase(c.legs, "leg") : null,
    c.stops > 0 ? countPhrase(c.stops, "stop") : null,
    c.reservations > 0 ? countPhrase(c.reservations, "reservation") : null,
    c.ideas > 0 ? countPhrase(c.ideas, "idea") : null,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return "This can't be undone.";
  const listed =
    parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Its ${listed} ${parts.length === 1 ? "is" : "are"} deleted with it. This can't be undone.`;
}

/** Everything a `DELETE /api/legs/:id` cascades away. The leg is what you are
 * deleting, not what goes WITH it, so it never counts itself. */
export function legCascadeCounts(l: Leg): CascadeCounts {
  return {
    legs: 0,
    stops: l.stops.length,
    reservations: l.stops.reduce((n, s) => n + s.reservations.length, 0),
    ideas: l.stops.reduce((n, s) => n + s.ideas.length, 0),
  };
}

/** Everything a `DELETE /api/stops/:id` cascades away — its two leaf tables. */
export function stopCascadeCounts(s: Stop): CascadeCounts {
  return { legs: 0, stops: 0, reservations: s.reservations.length, ideas: s.ideas.length };
}

/**
 * The title "Add leg" sends. It counts the legs there are rather than reading
 * the highest sortOrder, so the name matches the "Leg N" kicker the route lens
 * renders — and the first one is "Leg 1", exactly what `createTrip` seeds.
 */
export function nextLegTitle(t: Trip): string {
  return `Leg ${t.legs.length + 1}`;
}

// ── the stop-dates dialog ──────────────────────────────────────────────────

/** What the dialog holds. Both are "" for null, the way a date input holds it. */
export interface StopDatesDraft {
  arriveDate: string;
  departDate: string;
}

/** The stop, as the dialog's opening state. A floating stop opens blank. */
export function stopDatesDraft(s: Stop): StopDatesDraft {
  return { arriveDate: s.arriveDate ?? "", departDate: s.departDate ?? "" };
}

/**
 * "5 days · Aug 12 is the drive day in" — the length, and which day you spend
 * driving. The arrival day is the drive day (derive-days.ts): it is the only
 * day of the span that is not a stay. `null` while the range is unusable, which
 * is the same condition that disables Save.
 */
export function stopDatesHelp(d: StopDatesDraft): string | null {
  const days = tripDayCount(d.arriveDate, d.departDate);
  if (days === null) return null;
  const arrive = d.arriveDate as IsoDate;
  return `${days} day${days === 1 ? "" : "s"} · ${formatDateSpan(arrive, arrive)} is the drive day in`;
}

/**
 * The `PATCH /api/stops/:id` body for the dialog's Save: both dates, or `{}`
 * when neither moved. `null` means the range is not submittable — and it is the
 * same `null` the Save button is disabled on, so there is one rule, not two.
 */
export function stopDatesPatch(s: Stop, d: StopDatesDraft): StopPatchInput | null {
  if (tripDayCount(d.arriveDate, d.departDate) === null) return null;
  if (d.arriveDate === s.arriveDate && d.departDate === s.departDate) return {};
  return { arriveDate: d.arriveDate as IsoDate, departDate: d.departDate as IsoDate };
}

/** "Unschedule" — one PATCH setting BOTH dates to null, so the stop drops back
 * to the floating rail rather than half-landing on the calendar. */
export function unscheduleStopPatch(): StopPatchInput {
  return { arriveDate: null, departDate: null };
}
