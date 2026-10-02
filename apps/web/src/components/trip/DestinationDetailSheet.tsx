"use client";

import { useState } from "react";
import {
  X,
  CalendarDays,
  CalendarPlus,
  Receipt,
  Plus,
  Check,
  Lightbulb,
  MapPin,
  MapPinX,
  Pencil,
  Trash2,
  CornerRightUp,
} from "lucide-react";
import type {
  DateSpan,
  Idea,
  LodgingKind,
  NearPlace,
  SearchAnchor,
  PickedPlace,
  ReservationDraft,
  ReservationType,
  Destination,
} from "@rv-trip/core";
import {
  ideaIsLocated,
  isScheduled,
  isStayType,
  stayNameLabel,
  withStayKind,
  nearLabel,
  pickedFromPlace,
  reservationCost,
  reservationDraftInput,
  reservationDraftPatch,
} from "@rv-trip/core";
import {
  Stars,
  DrillRow,
  FieldLabel,
  ReservationCard,
  IdeaCard,
  SegmentedControl,
  RangePicker,
  categoryMeta,
  ideaCategoryType,
  money,
} from "@rv-trip/ui";
import { ChangeBylinePopover } from "@/components/history/ChangeBylinePopover";
import { GoogleLine } from "@/components/places/GoogleLine";
import { dateRange } from "@/lib/trip-ui";
import { resDates } from "@/lib/trip-logic";
import { DestinationMiniMap } from "@/components/map/DestinationMiniMap";
import { PlacePicker } from "@/components/places/PlacePicker";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { MenuHint, RowMenu, MENU_ITEM, MENU_ITEM_WARN } from "./row-menu";
import { StayPlaceField } from "./AddStaySheet";
import { KIND_OPTIONS } from "./stay-kinds";

/** A stored stay's name, as the picker's picked state shows it. */
const pickedName = (name: string): PickedPlace => ({
  name,
  lat: null,
  lng: null,
  googlePlaceId: null,
  address: null,
  rating: null,
  primaryType: null,
});

/**
 * The Type select (#105 · klunk row 5): "Stay" first — a UI grouping, not an
 * enum value; the kind switch under it decides campground vs lodging — then
 * Eat · Dining, Do · Tour / Activity / Event, and Other. Transport is gone from
 * a destination's form: flights and ferries go on the hop (#104). A legacy transport
 * row being EDITED still shows its own type, so opening it never rewrites it.
 */
const TYPE_OPTIONS: { value: "stay" | ReservationType; label: string }[] = [
  { value: "stay", label: "Stay" },
  { value: "dining", label: "Eat · Dining" },
  { value: "tour", label: "Do · Tour" },
  { value: "activity", label: "Do · Activity" },
  { value: "event", label: "Do · Event" },
  { value: "other", label: "Other" },
];

/** The eight types, in their shipped order — the idea's "Book as" picker,
 * which this issue does not change. */
const RES_TYPES: ReservationType[] = [
  "campground",
  "lodging",
  "dining",
  "event",
  "tour",
  "activity",
  "transport",
  "other",
];


/** The sheet's one input skin — the surface palette, not the dialog's navy. */
const SHEET_FIELD =
  "w-full rounded-rv-md border border-rv-border-hi bg-rv-surface px-2.5 py-2 text-[13px] text-rv-ink";

/**
 * Everything the sheet's two LEAVES do. Bundled the way RouteView's row-menu
 * verbs are, so growing the reservation form from three fields to six did not
 * grow the sheet's signature by ten callbacks.
 */
export interface DestinationLeafActions {
  /** the reservation whose edit form is open, `"new"` for the add form, or
   * `null` when no form is open — one form, two jobs */
  formTarget: string | "new" | null;
  form: ReservationDraft;
  onOpenAdd: () => void;
  onOpenEdit: (resId: string) => void;
  onFormChange: (patch: Partial<ReservationDraft>) => void;
  onFormCancel: () => void;
  onFormSubmit: () => void;
  /** a leaf delete: optimistic, no confirm, a six-second undo toast */
  onDeleteReservation: (resId: string) => void;

  ideaAddOpen: boolean;
  ideaDraft: string;
  /** The idea form's OPTIONAL place (#60 Q5 → A). An idea can still be just a
   * title — that is what an idea is — so Save is disabled on an empty title
   * only, and `ideaCreateInput` already carried `place`, so this is UI only. */
  ideaPicked: PickedPlace | null;
  onIdeaPickedChange: (p: PickedPlace | null) => void;
  onToggleIdeaAdd: () => void;
  onIdeaDraftChange: (v: string) => void;
  onSubmitIdea: () => void;
  onDeleteIdea: (ideaId: string) => void;
  /** #80 gesture 3 — the attached idea goes BACK to the trip's shelf. The
   * drag has no source here (an attached idea is not a shelf card), so the
   * menu is its door; the write is the same `PATCH { destinationId: null }`. */
  onDetachIdea: (ideaId: string) => void;

  /** #69 · the row's Locate. Unlike the map's batch — which geocodes a title
   * server-side — this one lets the human choose, so the picked place is
   * written straight through the idea PATCH. `null` clears it. */
  onLocateIdea: (ideaId: string, picked: PickedPlace | null) => void;

  /** #74 · the clear that finally has a door. Fires the shipped
   * `PATCH { place: null }`, and only ever from place-state 3 — see the menu
   * below, which is derived from `ideaIsLocated`. */
  onClearIdeaPlace: (ideaId: string) => void;

  /** "Book" opens the type picker rather than promoting straight away — the
   * type is the whole point of the gesture. */
  promotingId: string | null;
  promoteType: ReservationType;
  onStartPromote: (ideaId: string) => void;
  onPromoteTypeChange: (t: ReservationType) => void;
  onCancelPromote: () => void;
  onConfirmPromote: () => void;
}

export function DestinationDetailSheet({
  destination,
  chapterName,
  destinationOrdinal,
  costs,
  lodgingDefault = null,
  leaves,
  ideaNoteOpen,
  onClose,
  onSchedule,
  onSetRating,
  onSetNote,
  onCommitNote,
  onResRating,
  onResNote,
  onCommitResNote,
  onIdeaCycle,
  onIdeaRating,
  onIdeaNote,
  onCommitIdeaNote,
  onIdeaToggleNote,
  placing,
  placeNear,
  destinationNear,
  tripSpan,
  onStartChangePlace,
  onChangePlace,
  onCancelChangePlace,
}: {
  destination: Destination;
  chapterName: string;
  /** Position in the trip's scheduled sequence — the number the mini-map's disc
   * carries, so the sheet and /map count the destinations the same way. */
  destinationOrdinal: number | null;
  costs: boolean;
  /** The trip's lodging default (#105 · Q3 A) — the kind "Stay" opens on. */
  lodgingDefault?: LodgingKind | null;
  leaves: DestinationLeafActions;
  ideaNoteOpen: Set<string>;
  onClose: () => void;
  onSchedule: () => void;
  onSetRating: (n: number) => void;
  onSetNote: (v: string) => void;
  onCommitNote: () => void;
  onResRating: (resId: string, n: number) => void;
  onResNote: (resId: string, v: string) => void;
  onCommitResNote: (resId: string) => void;
  onIdeaCycle: (ideaId: string) => void;
  onIdeaRating: (ideaId: string, n: number) => void;
  onIdeaNote: (ideaId: string, v: string) => void;
  onCommitIdeaNote: (ideaId: string) => void;
  onIdeaToggleNote: (ideaId: string) => void;

  // ── #60 · Mount B · the same inline editor the row menu opens ────────────
  placing: boolean;
  /** The search bias for "Change place…" — #126's anchor for a destination: the destination
   * above it, then the trip's area (never the home base). */
  placeNear: NearPlace | null;
  /** #126 · this destination's own anchor (this destination → the trip's area) — the
   * idea picker's and the stay search's bias. */
  destinationNear: SearchAnchor | null;
  /** #127 · the trip's dates — the stay form's RangePicker band. */
  tripSpan: DateSpan;
  onStartChangePlace: () => void;
  onChangePlace: (picked: PickedPlace) => void;
  onCancelChangePlace: () => void;
}) {
  const scheduled = isScheduled(destination);
  const dates = scheduled ? dateRange(destination.arriveDate, destination.departDate) : "Floating";
  /** Which idea row has its picker open — one at a time, the sheet's own
   * state. The DS card renders the slot; it never knows about it. */
  const [locatingIdeaId, setLocatingIdeaId] = useState<string | null>(null);
  /**
   * An idea's search bias is THIS destination, not the one above it. `placeNear` is
   * `destinationAbove(...)` — right for "where is the next destination", wrong for a thing
   * that happens here — so this destination's own place leads, and `placeNear` (the
   * previous destination, else home base) is the fallback for a destination with no
   * coordinates of its own.
   */
  const ideaNear = destinationNear;
  const costTotal = destination.reservations.reduce((a, r) => a + (r.cost ?? 0), 0);

  const editing =
    leaves.formTarget && leaves.formTarget !== "new"
      ? (destination.reservations.find((r) => r.id === leaves.formTarget) ?? null)
      : null;
  // The same rule that builds the body disables Save, so there is one rule and
  // not two: a create is submittable when it yields a body, an edit when its
  // patch is not null (an empty patch is a legal "nothing changed").
  const canSave =
    leaves.formTarget === "new"
      ? reservationDraftInput(destination.id, leaves.form) !== null
      : editing !== null && reservationDraftPatch(editing, leaves.form) !== null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-40 flex justify-end"
      style={{ background: "color-mix(in srgb, var(--color-rv-navy) 42%, transparent)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-[min(500px,100%)] flex-col overflow-y-auto bg-rv-surface-alt shadow-rv-xl"
      >
        {/* Sticky header */}
        <div className="dark sticky top-0 z-[1] bg-rv-navy px-6 py-5 text-rv-ink">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-rv-green-on-dark">
                {chapterName}
              </div>
              <h2 className="m-0 text-[28px] font-extrabold tracking-[-0.02em] text-rv-ink">
                {destination.place.name}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex size-[34px] flex-none cursor-pointer items-center justify-center rounded-rv-pill border-none text-rv-ink"
              style={{ background: "color-mix(in srgb, white 14%, transparent)" }}
            >
              <X className="size-[18px]" />
            </button>
          </div>
          <div className="mt-3.5 flex flex-wrap items-center gap-3.5">
            <span className="inline-flex items-center gap-1.5 font-mono text-[13px] text-rv-ink-muted">
              <CalendarDays className="size-4" />
              {dates}
            </span>
            {!scheduled && (
              <button
                type="button"
                onClick={onSchedule}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-rv-pill border-none bg-rv-green-on-dark px-[13px] py-1.5 text-[13px] font-semibold text-rv-navy"
              >
                <CalendarPlus className="size-4" />
                Schedule
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6 p-6">
          <div className="flex flex-col gap-2.5">
            <DestinationMiniMap
              destination={destination}
              chapterName={chapterName}
              ordinal={destinationOrdinal}
              onChangePlace={placing ? undefined : onStartChangePlace}
            />
            {placing && (
              <div>
                {placeNear && (
                  <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-rv-ink-faded">
                    {nearLabel(placeNear)}
                  </div>
                )}
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <SheetPlacePicker
                      destination={destination}
                      near={placeNear}
                      onChangePlace={onChangePlace}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={onCancelChangePlace}
                    aria-label={`Stop changing the place for ${destination.place.name}`}
                    className="mt-[3px] inline-flex flex-none cursor-pointer items-center justify-center rounded-rv-sm border border-rv-border bg-transparent p-1 text-rv-ink-faded"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Reservations */}
          <div>
            <div className="mb-3 flex items-center justify-between gap-2.5">
              <h3 className="m-0 text-[17px] font-bold text-rv-ink">Reservations</h3>
              <button
                type="button"
                onClick={leaves.onOpenAdd}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-rv-pill border border-rv-green bg-rv-green-soft px-3 py-1.5 text-[13px] font-semibold text-rv-green"
              >
                <Plus className="size-3.5" />
                Add
              </button>
            </div>

            {/* One form, two jobs: the add form and the full edit. Every field
                on the core `reservation` schema is here — the dates the form
                used to collect and throw away included. */}
            {leaves.formTarget && (
              <ReservationForm
                form={leaves.form}
                costs={costs}
                lodgingDefault={lodgingDefault}
                destinationNear={destinationNear}
                tripSpan={tripSpan}
                editing={editing !== null}
                canSave={canSave}
                onChange={leaves.onFormChange}
                onSubmit={leaves.onFormSubmit}
                onCancel={leaves.onFormCancel}
              />
            )}

            <div className="flex flex-col gap-2.5">
              {destination.reservations.map((r) => (
                <ReservationCard
                  key={r.id}
                  reservation={costs ? r : { ...r, cost: null }}
                  dates={resDates(r)}
                  onRating={(n) => onResRating(r.id, n)}
                  onNote={(v) => onResNote(r.id, v)}
                  onCommitNote={() => onCommitResNote(r.id)}
                  actions={
                    <RowMenu label={`Actions for ${r.name}`}>
                      <DropdownMenuItem
                        className={MENU_ITEM}
                        onSelect={() => leaves.onOpenEdit(r.id)}
                      >
                        <Pencil />
                        Edit…
                        <MenuHint>form</MenuHint>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="mx-0.5 my-1 bg-rv-border" />
                      <DropdownMenuItem
                        className={MENU_ITEM_WARN}
                        onSelect={() => leaves.onDeleteReservation(r.id)}
                      >
                        <Trash2 />
                        Delete
                        <MenuHint>undo</MenuHint>
                      </DropdownMenuItem>
                    </RowMenu>
                  }
                />
              ))}
            </div>
          </div>

          {/* Ideas — the maybes. The header is always here, because a destination with
              no ideas is exactly where you want to add the first one. */}
          <div>
            <div className="mb-3 flex items-center justify-between gap-2.5">
              <h3 className="m-0 text-[17px] font-bold text-rv-ink">Ideas</h3>
              <button
                type="button"
                onClick={leaves.onToggleIdeaAdd}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-rv-pill border border-rv-green bg-rv-green-soft px-3 py-1.5 text-[13px] font-semibold text-rv-green"
              >
                <Plus className="size-3.5" />
                Add
              </button>
            </div>

            {leaves.ideaAddOpen && (
              <div className="mb-3 flex flex-col gap-2.5 rounded-rv-card border border-rv-border bg-rv-surface p-4">
                <label className="flex flex-col gap-1">
                  <FieldLabel>Idea</FieldLabel>
                  <input
                    value={leaves.ideaDraft}
                    onChange={(e) => leaves.onIdeaDraftChange(e.target.value)}
                    placeholder="e.g. Cape Perpetua overlook"
                    className={SHEET_FIELD}
                  />
                </label>
                <div className="flex flex-col gap-1">
                  <FieldLabel>
                    Place{" "}
                    <span className="font-sans font-normal normal-case tracking-normal text-rv-ink-faded">
                      optional
                    </span>
                  </FieldLabel>
                  <PlacePicker
                    value={leaves.ideaPicked}
                    onChange={leaves.onIdeaPickedChange}
                    near={placeNear}
                  />
                </div>
                <button
                  type="button"
                  onClick={leaves.onSubmitIdea}
                  disabled={leaves.ideaDraft.trim() === ""}
                  className="inline-flex cursor-pointer items-center gap-1.5 self-start rounded-rv-md border-none bg-rv-accent-deep px-4 py-2 text-[13px] font-semibold text-rv-accent-ink disabled:cursor-default disabled:opacity-45"
                >
                  <Check className="size-4" />
                  Save idea
                </button>
              </div>
            )}

            {destination.ideas.length > 0 && (
              <div className="flex flex-col gap-2">
                {destination.ideas.map((it) => (
                  <div key={it.id} className="flex flex-col gap-2">
                    <IdeaCard
                      idea={it}
                      noteVisible={ideaNoteOpen.has(it.id) || !!(it.notes && it.notes.trim())}
                      /* #82 Q2 → B. The ✎ button is the expand and the sheet's
                         own `ideaNoteOpen` set is the expand state — the same
                         set, not new state. An idea that merely HAS a note
                         still shows only that note (the row collapsed is
                         exactly what shipped), so the sheet's density is
                         untouched for anyone who is not researching. */
                      expanded={ideaNoteOpen.has(it.id)}
                      /* An attached idea's locality is its parent DESTINATION's place
                         name — `place_name` is NOT NULL in the schema, so an
                         attached idea always has one. `Idea` itself carries no
                         locality, which is exactly why this is filled here and
                         not in the kit. */
                      drill={
                        <DrillRow
                          name={it.title}
                          locality={destination.place.name}
                          type={ideaCategoryType(it.category)}
                        />
                      }
                      gline={<GoogleLine googlePlaceId={it.place?.googlePlaceId} />}
                      byline={
                        <ChangeBylinePopover
                          last={it.lastChange}
                          entity="idea"
                          entityId={it.id}
                          name={it.title}
                        />
                      }
                      onCycle={() => onIdeaCycle(it.id)}
                      onRating={(n) => onIdeaRating(it.id, n)}
                      onNote={(v) => onIdeaNote(it.id, v)}
                      onCommitNote={() => onCommitIdeaNote(it.id)}
                      onToggleNote={() => onIdeaToggleNote(it.id)}
                      onPromote={() => leaves.onStartPromote(it.id)}
                      onLocate={() => setLocatingIdeaId(it.id)}
                      picker={
                        locatingIdeaId === it.id ? (
                          <IdeaPlacePicker
                            idea={it}
                            near={ideaNear}
                            onPick={(picked) => {
                              leaves.onLocateIdea(it.id, picked);
                              setLocatingIdeaId(null);
                            }}
                            onCancel={() => setLocatingIdeaId(null)}
                          />
                        ) : undefined
                      }
                      actions={
                        <RowMenu label={`Actions for ${it.title}`}>
                          <DropdownMenuItem
                            className={MENU_ITEM}
                            onSelect={() => leaves.onDetachIdea(it.id)}
                          >
                            <Lightbulb />
                            Move to ideas
                            <MenuHint>→ the shelf</MenuHint>
                          </DropdownMenuItem>
                          {/* #74 · place-state 3 only. A coordless or
                              place-less idea still carries Locate on its line,
                              so neither item renders for it — one derivation,
                              `ideaIsLocated`, behind both the line and this
                              menu. */}
                          {ideaIsLocated(it) && (
                            <>
                              <DropdownMenuItem
                                className={MENU_ITEM}
                                onSelect={() => setLocatingIdeaId(it.id)}
                              >
                                <MapPin />
                                Change place
                                <MenuHint>picker</MenuHint>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className={MENU_ITEM_WARN}
                                onSelect={() => leaves.onClearIdeaPlace(it.id)}
                              >
                                <MapPinX />
                                Clear place
                                <MenuHint>→ no place</MenuHint>
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuItem
                            className={MENU_ITEM_WARN}
                            onSelect={() => leaves.onDeleteIdea(it.id)}
                          >
                            <Trash2 />
                            Delete
                            <MenuHint>undo</MenuHint>
                          </DropdownMenuItem>
                        </RowMenu>
                      }
                    />

                    {/* "Book" picks the type on the way in, so a promoted lunch
                        stops arriving as a blue "Do". */}
                    {leaves.promotingId === it.id && (
                      <div className="flex flex-wrap items-end gap-2.5 rounded-rv-md border border-rv-border bg-rv-surface px-3 py-2.5">
                        <label className="flex flex-[1_1_160px] flex-col gap-1">
                          <FieldLabel>Book as</FieldLabel>
                          <select
                            value={leaves.promoteType}
                            onChange={(e) =>
                              leaves.onPromoteTypeChange(e.target.value as ReservationType)
                            }
                            className={SHEET_FIELD}
                          >
                            {RES_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {typeLabel(t)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          onClick={leaves.onConfirmPromote}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-rv-md border-none bg-rv-accent-deep px-4 py-2 text-[13px] font-semibold text-rv-accent-ink"
                        >
                          <CornerRightUp className="size-4" />
                          Book
                        </button>
                        <button
                          type="button"
                          onClick={leaves.onCancelPromote}
                          className="inline-flex cursor-pointer items-center rounded-rv-md border border-rv-border-hi bg-transparent px-3 py-2 text-[13px] font-semibold text-rv-ink-muted"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Our take — the memory */}
          <div>
            <h3 className="m-0 mb-1 text-[17px] font-bold text-rv-ink">Our take</h3>
            <p className="m-0 mb-3 text-[13px] text-rv-ink-faded">
              What we loved — the memory that seeds the next trip.
            </p>
            <div className="mb-3 flex items-center gap-2.5">
              <Stars value={destination.rating ?? 0} size={24} onSet={onSetRating} />
              <span className="font-mono text-[12px] text-rv-ink-faded">Tap to rate this destination</span>
            </div>
            <textarea
              value={destination.notes ?? ""}
              onChange={(e) => onSetNote(e.target.value)}
              onBlur={onCommitNote}
              placeholder="What did you love? What to remember for next time…"
              className="min-h-[96px] w-full resize-y rounded-rv-card border border-rv-border bg-rv-surface px-3.5 py-3 text-[14px] leading-relaxed text-rv-ink"
            />
            {/* The sheet composes its own Stars + textarea rather than the
                research pad, so the byline is mounted here directly (#78 §5). */}
            <div className="mt-[9px]">
              <ChangeBylinePopover
                last={destination.lastChange}
                entity="destination"
                entityId={destination.id}
                name={destination.place.name}
              />
            </div>
          </div>

          {/* Destination total — only when tracking costs */}
          {costs && (
            <div className="flex items-center justify-end gap-2 border-t border-rv-border-soft pt-4 font-mono text-[13px] text-rv-ink-faded">
              <Receipt className="size-4" />
              <span>Destination total</span>
              <span className="font-semibold text-rv-ink-muted">{money(costTotal)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** "Stay · Campground" — the five-category word the cards render, next to the
 * eight-value type the row actually stores. */
function typeLabel(t: ReservationType): string {
  return `${categoryMeta(t).cat} · ${t[0]!.toUpperCase()}${t.slice(1)}`;
}

/**
 * The one reservation form, for add and edit (#105). On Stay, the kind switch
 * (Campground · Hotel · Airbnb · Friends — the DS SegmentedControl) swaps the
 * fields: the name's label follows the kind, and Friends asks only who you're
 * staying with and the nights — no cost, no confirmation number. The mock's
 * campground "Site" field is dropped: no column holds it.
 */
function ReservationForm({
  form,
  costs,
  lodgingDefault,
  destinationNear,
  tripSpan,
  editing,
  canSave,
  onChange,
  onSubmit,
  onCancel,
}: {
  form: ReservationDraft;
  costs: boolean;
  lodgingDefault: LodgingKind | null;
  destinationNear: SearchAnchor | null;
  tripSpan: DateSpan;
  editing: boolean;
  canSave: boolean;
  onChange: (patch: Partial<ReservationDraft>) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const stay = isStayType(form.type);
  // A pre-W2 stay has no kind yet: it shows the kind its type implies, and
  // becomes a real kind the moment one is pressed.
  const kind: LodgingKind =
    form.lodgingKind ?? (form.type === "campground" ? "campground" : stay ? "hotel" : (lodgingDefault ?? "campground"));
  const friends = stay && kind === "friends";
  const typeValue = stay ? "stay" : form.type;
  const options =
    stay || TYPE_OPTIONS.some((o) => o.value === form.type)
      ? TYPE_OPTIONS
      : [...TYPE_OPTIONS, { value: form.type, label: typeLabel(form.type) }];

  const pickType = (v: string) => {
    if (v === "stay") onChange(withStayKind(form, form.lodgingKind ?? lodgingDefault ?? "campground"));
    else onChange({ type: v as ReservationType, lodgingKind: null });
  };

  return (
    <div className="mb-3 flex flex-col gap-2.5 rounded-rv-card border border-rv-border bg-rv-surface p-4">
      <label className="flex flex-col gap-1">
        <FieldLabel>Type</FieldLabel>
        <select value={typeValue} onChange={(e) => pickType(e.target.value)} className={SHEET_FIELD}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {stay && (
        <div>
          <SegmentedControl
            value={kind}
            options={KIND_OPTIONS}
            onChange={(k) => onChange(withStayKind(form, k))}
          />
        </div>
      )}

      {/* #128 · Q9 A — a stay's name field IS the anchored lodging search (the
          Add stay sheet's own field); Friends stays a name — it's people. */}
      {stay && !friends ? (
        <div className="flex flex-col gap-1">
          <FieldLabel>{stayNameLabel(kind)}</FieldLabel>
          <StayPlaceField
            value={form.name.trim() === "" ? null : pickedName(form.name)}
            anchor={destinationNear}
            onChange={(p) => onChange({ name: p?.name ?? "" })}
          />
        </div>
      ) : (
        <label className="flex flex-col gap-1">
          <FieldLabel>{stay ? stayNameLabel(kind) : "Name"}</FieldLabel>
          <input
            value={form.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder={friends ? "Jane & Rick" : "e.g. Fort Stevens State Park"}
            className={SHEET_FIELD}
          />
        </label>
      )}
      {/* #127 · one RangePicker in place of the two native date inputs, the
          trip's span as its band. A reservation's dates are optional, so the
          picker starts empty on a new one. */}
      <div className="flex flex-col gap-1">
        <FieldLabel>{friends ? "Nights" : "Check-in → check-out"}</FieldLabel>
        <RangePicker
          value={{ start: form.checkIn || null, end: form.checkOut || null }}
          tripSpan={tripSpan}
          onChange={(v) => onChange({ checkIn: v.start ?? "", checkOut: v.end ?? "" })}
        />
      </div>
      {friends ? (
        <div className="font-mono text-[11.5px] text-rv-ink-faded">
          No cost and no confirmation number. It&apos;s their couch.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2.5">
          <label className="flex flex-[1_1_130px] flex-col gap-1">
            <FieldLabel>Confirmation #</FieldLabel>
            <input
              value={form.confirmationNumber}
              onChange={(e) => onChange({ confirmationNumber: e.target.value })}
              placeholder="optional"
              className={SHEET_FIELD}
            />
          </label>
          {costs && (
            <label className="flex flex-[1_1_90px] flex-col gap-1">
              <FieldLabel>Cost $</FieldLabel>
              <input
                value={form.cost}
                onChange={(e) => onChange({ cost: e.target.value })}
                inputMode="numeric"
                placeholder="0"
                aria-invalid={reservationCost(form.cost) === undefined}
                className={SHEET_FIELD}
              />
            </label>
          )}
        </div>
      )}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSave}
          className="inline-flex cursor-pointer items-center gap-1.5 self-start rounded-rv-md border-none bg-rv-accent-deep px-4 py-2 text-[13px] font-semibold text-rv-accent-ink disabled:cursor-default disabled:opacity-45"
        >
          <Check className="size-4" />
          {editing ? "Save changes" : "Save reservation"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex cursor-pointer items-center rounded-rv-md border border-rv-border-hi bg-transparent px-3 py-2 text-[13px] font-semibold text-rv-ink-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Mount B's editor. The value is held here, not read off the destination, so clearing
 * the chip (✕) really does drop back to the search box — a value read straight
 * from the row would snap back on the next render. Same reason `PlaceEditor` in
 * RouteView holds its own.
 */
/**
 * The row's Locate picker (#69) — `PlacePicker` as it ships, mounted inline in
 * the scrolling sheet with the `near` line the change-place mount already
 * draws. It starts EMPTY rather than seeded from the idea: the row has a place
 * line showing what it has, and this is the gesture that replaces it.
 */
function IdeaPlacePicker({
  idea,
  near,
  onPick,
  onCancel,
}: {
  idea: Idea;
  near: NearPlace | null;
  onPick: (picked: PickedPlace | null) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<PickedPlace | null>(null);
  return (
    <div className="rounded-rv-md border border-rv-border bg-rv-surface px-2.5 py-[9px]">
      {near && (
        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-rv-ink-faded">
          {nearLabel(near)}
        </div>
      )}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <PlacePicker
            value={value}
            onChange={(picked) => {
              setValue(picked);
              if (picked) onPick(picked);
            }}
            near={near}
          />
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label={`Stop setting a place for ${idea.title}`}
          className="mt-[3px] inline-flex flex-none cursor-pointer items-center justify-center rounded-rv-sm border border-rv-border bg-transparent p-1 text-rv-ink-faded"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function SheetPlacePicker({
  destination,
  near,
  onChangePlace,
}: {
  destination: Destination;
  near: NearPlace | null;
  onChangePlace: (picked: PickedPlace) => void;
}) {
  const [value, setValue] = useState<PickedPlace | null>(() => pickedFromPlace(destination.place));
  return (
    <PlacePicker
      value={value}
      onChange={(picked) => {
        setValue(picked);
        if (picked) onChangePlace(picked);
      }}
      near={near}
    />
  );
}
