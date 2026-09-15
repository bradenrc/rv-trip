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
  Idea,
  NearPlace,
  PickedPlace,
  ReservationDraft,
  ReservationType,
  Stop,
} from "@rv-trip/core";
import {
  ideaIsLocated,
  isScheduled,
  nearLabel,
  nearOf,
  pickedFromPlace,
  reservationCost,
  reservationDraftInput,
  reservationDraftPatch,
} from "@rv-trip/core";
import {
  Stars,
  FieldLabel,
  ReservationCard,
  IdeaCard,
  categoryMeta,
  money,
} from "@rv-trip/ui";
import { dateRange } from "@/lib/trip-ui";
import { resDates } from "@/lib/trip-logic";
import { StopMiniMap } from "@/components/map/StopMiniMap";
import { PlacePicker } from "@/components/places/PlacePicker";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { MenuHint, RowMenu, MENU_ITEM, MENU_ITEM_WARN } from "./row-menu";

/**
 * The eight reservation types, in the order the shipped form has always listed
 * them. `categoryMeta` collapses them 8 → 5 for colour and language (Stay ←
 * campground|lodging, Do ← tour|activity|event), and that collapse does not
 * invert — so the picker names the five-category vocabulary the cards render
 * WITH the type it is actually writing ("Stay · Campground"), rather than
 * offering five options it could not turn back into a type.
 */
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
export interface StopLeafActions {
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
   * menu is its door; the write is the same `PATCH { stopId: null }`. */
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

export function StopDetailSheet({
  stop,
  legName,
  stopOrdinal,
  costs,
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
  onStartChangePlace,
  onChangePlace,
  onCancelChangePlace,
}: {
  stop: Stop;
  legName: string;
  /** Position in the trip's scheduled sequence — the number the mini-map's disc
   * carries, so the sheet and /map count the stops the same way. */
  stopOrdinal: number | null;
  costs: boolean;
  leaves: StopLeafActions;
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
  /** The search bias — the stop above this one in the leg, else home base. */
  placeNear: NearPlace | null;
  onStartChangePlace: () => void;
  onChangePlace: (picked: PickedPlace) => void;
  onCancelChangePlace: () => void;
}) {
  const scheduled = isScheduled(stop);
  const dates = scheduled ? dateRange(stop.arriveDate, stop.departDate) : "Floating";
  /** Which idea row has its picker open — one at a time, the sheet's own
   * state. The DS card renders the slot; it never knows about it. */
  const [locatingIdeaId, setLocatingIdeaId] = useState<string | null>(null);
  /**
   * An idea's search bias is THIS stop, not the one above it. `placeNear` is
   * `stopAbove(...)` — right for "where is the next stop", wrong for a thing
   * that happens here — so this stop's own place leads, and `placeNear` (the
   * previous stop, else home base) is the fallback for a stop with no
   * coordinates of its own.
   */
  const ideaNear = nearOf(stop.place, placeNear);
  const costTotal = stop.reservations.reduce((a, r) => a + (r.cost ?? 0), 0);

  const editing =
    leaves.formTarget && leaves.formTarget !== "new"
      ? (stop.reservations.find((r) => r.id === leaves.formTarget) ?? null)
      : null;
  // The same rule that builds the body disables Save, so there is one rule and
  // not two: a create is submittable when it yields a body, an edit when its
  // patch is not null (an empty patch is a legal "nothing changed").
  const canSave =
    leaves.formTarget === "new"
      ? reservationDraftInput(stop.id, leaves.form) !== null
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
                {legName}
              </div>
              <h2 className="m-0 text-[28px] font-extrabold tracking-[-0.02em] text-rv-ink">
                {stop.place.name}
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
            <StopMiniMap
              stop={stop}
              legName={legName}
              ordinal={stopOrdinal}
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
                      stop={stop}
                      near={placeNear}
                      onChangePlace={onChangePlace}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={onCancelChangePlace}
                    aria-label={`Stop changing the place for ${stop.place.name}`}
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
              <div className="mb-3 flex flex-col gap-2.5 rounded-rv-card border border-rv-border bg-rv-surface p-4">
                <div className="flex flex-wrap gap-2.5">
                  <label className="flex flex-[1_1_150px] flex-col gap-1">
                    <FieldLabel>Type</FieldLabel>
                    <select
                      value={leaves.form.type}
                      onChange={(e) =>
                        leaves.onFormChange({ type: e.target.value as ReservationType })
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
                  {costs && (
                    <label className="flex flex-[1_1_90px] flex-col gap-1">
                      <FieldLabel>Cost $</FieldLabel>
                      <input
                        value={leaves.form.cost}
                        onChange={(e) => leaves.onFormChange({ cost: e.target.value })}
                        inputMode="numeric"
                        placeholder="0"
                        aria-invalid={reservationCost(leaves.form.cost) === undefined}
                        className={SHEET_FIELD}
                      />
                    </label>
                  )}
                </div>
                <label className="flex flex-col gap-1">
                  <FieldLabel>Name</FieldLabel>
                  <input
                    value={leaves.form.name}
                    onChange={(e) => leaves.onFormChange({ name: e.target.value })}
                    placeholder="e.g. Fort Stevens State Park"
                    className={SHEET_FIELD}
                  />
                </label>
                <div className="flex flex-wrap gap-2.5">
                  <label className="flex flex-[1_1_130px] flex-col gap-1">
                    <FieldLabel>Check-in</FieldLabel>
                    <input
                      type="date"
                      value={leaves.form.checkIn}
                      onChange={(e) => leaves.onFormChange({ checkIn: e.target.value })}
                      className={SHEET_FIELD}
                    />
                  </label>
                  <label className="flex flex-[1_1_130px] flex-col gap-1">
                    <FieldLabel>Check-out</FieldLabel>
                    <input
                      type="date"
                      value={leaves.form.checkOut}
                      onChange={(e) => leaves.onFormChange({ checkOut: e.target.value })}
                      className={SHEET_FIELD}
                    />
                  </label>
                </div>
                <label className="flex flex-col gap-1">
                  <FieldLabel>Confirmation #</FieldLabel>
                  <input
                    value={leaves.form.confirmationNumber}
                    onChange={(e) => leaves.onFormChange({ confirmationNumber: e.target.value })}
                    placeholder="e.g. KOA-88213"
                    className={SHEET_FIELD}
                  />
                </label>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={leaves.onFormSubmit}
                    disabled={!canSave}
                    className="inline-flex cursor-pointer items-center gap-1.5 self-start rounded-rv-md border-none bg-rv-accent-deep px-4 py-2 text-[13px] font-semibold text-rv-accent-ink disabled:cursor-default disabled:opacity-45"
                  >
                    <Check className="size-4" />
                    {editing ? "Save changes" : "Save reservation"}
                  </button>
                  <button
                    type="button"
                    onClick={leaves.onFormCancel}
                    className="inline-flex cursor-pointer items-center rounded-rv-md border border-rv-border-hi bg-transparent px-3 py-2 text-[13px] font-semibold text-rv-ink-muted"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2.5">
              {stop.reservations.map((r) => (
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

          {/* Ideas — the maybes. The header is always here, because a stop with
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

            {stop.ideas.length > 0 && (
              <div className="flex flex-col gap-2">
                {stop.ideas.map((it) => (
                  <div key={it.id} className="flex flex-col gap-2">
                    <IdeaCard
                      idea={it}
                      noteVisible={ideaNoteOpen.has(it.id) || !!(it.notes && it.notes.trim())}
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
              <Stars value={stop.rating ?? 0} size={24} onSet={onSetRating} />
              <span className="font-mono text-[12px] text-rv-ink-faded">Tap to rate this stop</span>
            </div>
            <textarea
              value={stop.notes ?? ""}
              onChange={(e) => onSetNote(e.target.value)}
              onBlur={onCommitNote}
              placeholder="What did you love? What to remember for next time…"
              className="min-h-[96px] w-full resize-y rounded-rv-card border border-rv-border bg-rv-surface px-3.5 py-3 text-[14px] leading-relaxed text-rv-ink"
            />
          </div>

          {/* Stop total — only when tracking costs */}
          {costs && (
            <div className="flex items-center justify-end gap-2 border-t border-rv-border-soft pt-4 font-mono text-[13px] text-rv-ink-faded">
              <Receipt className="size-4" />
              <span>Stop total</span>
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
 * Mount B's editor. The value is held here, not read off the stop, so clearing
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
  stop,
  near,
  onChangePlace,
}: {
  stop: Stop;
  near: NearPlace | null;
  onChangePlace: (picked: PickedPlace) => void;
}) {
  const [value, setValue] = useState<PickedPlace | null>(() => pickedFromPlace(stop.place));
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
