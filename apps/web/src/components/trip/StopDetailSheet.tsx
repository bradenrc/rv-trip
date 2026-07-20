"use client";

import {
  X,
  CalendarDays,
  CalendarPlus,
  Map as MapIcon,
  Receipt,
  Plus,
  CornerRightUp,
  SquarePen,
  Check,
} from "lucide-react";
import type { Stop, ReservationType } from "@rv-trip/core";
import { isScheduled } from "@rv-trip/core";
import { categoryMeta, Stars, CategoryTile, StatusPill, FieldLabel } from "@rv-trip/ui";
import { money, dateRange } from "@/lib/trip-ui";
import { resDates } from "@/lib/trip-logic";
import type { AddForm } from "./TripPlanner";

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

export function StopDetailSheet({
  stop,
  legName,
  addOpen,
  form,
  ideaNoteOpen,
  onClose,
  onSchedule,
  onSetRating,
  onSetNote,
  onCommitNote,
  onToggleAdd,
  onFormChange,
  onSubmitAdd,
  onResRating,
  onResNote,
  onCommitResNote,
  onIdeaCycle,
  onIdeaRating,
  onIdeaNote,
  onCommitIdeaNote,
  onIdeaToggleNote,
  onPromote,
}: {
  stop: Stop;
  legName: string;
  addOpen: boolean;
  form: AddForm;
  ideaNoteOpen: Set<string>;
  onClose: () => void;
  onSchedule: () => void;
  onSetRating: (n: number) => void;
  onSetNote: (v: string) => void;
  onCommitNote: () => void;
  onToggleAdd: () => void;
  onFormChange: (patch: Partial<AddForm>) => void;
  onSubmitAdd: () => void;
  onResRating: (resId: string, n: number) => void;
  onResNote: (resId: string, v: string) => void;
  onCommitResNote: (resId: string) => void;
  onIdeaCycle: (ideaId: string) => void;
  onIdeaRating: (ideaId: string, n: number) => void;
  onIdeaNote: (ideaId: string, v: string) => void;
  onCommitIdeaNote: (ideaId: string) => void;
  onIdeaToggleNote: (ideaId: string) => void;
  onPromote: (ideaId: string) => void;
}) {
  const scheduled = isScheduled(stop);
  const dates = scheduled ? dateRange(stop.arriveDate, stop.departDate) : "Floating";
  const costTotal = stop.reservations.reduce((a, r) => a + (r.cost ?? 0), 0);

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
        <div className="sticky top-0 z-[1] bg-rv-navy px-6 py-5 text-rv-surface">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-rv-green-on-dark">
                {legName}
              </div>
              <h2 className="m-0 text-[28px] font-extrabold tracking-[-0.02em] text-rv-surface">
                {stop.place.name}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex size-[34px] flex-none cursor-pointer items-center justify-center rounded-rv-pill border-none text-rv-surface"
              style={{ background: "color-mix(in srgb, white 14%, transparent)" }}
            >
              <X className="size-[18px]" />
            </button>
          </div>
          <div className="mt-3.5 flex flex-wrap items-center gap-3.5">
            <span className="inline-flex items-center gap-1.5 font-mono text-[13px] text-rv-navy-soft">
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
          {/* Map placeholder */}
          <div className="flex h-[150px] flex-col items-center justify-center gap-1.5 rounded-rv-card border border-rv-border bg-rv-navy-soft text-rv-ink-faded">
            <MapIcon className="size-[30px] text-rv-navy" />
            <span className="font-mono text-[12px]">Map — {stop.place.name}</span>
          </div>

          {/* Reservations */}
          <div>
            <div className="mb-3 flex items-center justify-between gap-2.5">
              <h3 className="m-0 text-[17px] font-bold text-rv-navy">Reservations</h3>
              <button
                type="button"
                onClick={onToggleAdd}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-rv-pill border border-rv-green bg-rv-green-soft px-3 py-1.5 text-[13px] font-semibold text-rv-green-cta"
              >
                <Plus className="size-3.5" />
                Add
              </button>
            </div>

            {addOpen && (
              <div className="mb-3 flex flex-col gap-2.5 rounded-rv-card border border-rv-border bg-rv-surface p-4">
                <div className="flex flex-wrap gap-2.5">
                  <label className="flex flex-[1_1_130px] flex-col gap-1">
                    <FieldLabel>Type</FieldLabel>
                    <select
                      value={form.type}
                      onChange={(e) => onFormChange({ type: e.target.value as ReservationType })}
                      className="rounded-rv-md border border-rv-border-hi bg-rv-surface px-2.5 py-2 text-[13px] text-rv-ink"
                    >
                      {RES_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t[0]!.toUpperCase() + t.slice(1)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-[1_1_90px] flex-col gap-1">
                    <FieldLabel>Cost $</FieldLabel>
                    <input
                      value={form.cost}
                      onChange={(e) => onFormChange({ cost: e.target.value })}
                      inputMode="numeric"
                      placeholder="0"
                      className="w-full rounded-rv-md border border-rv-border-hi bg-rv-surface px-2.5 py-2 text-[13px] text-rv-ink"
                    />
                  </label>
                </div>
                <label className="flex flex-col gap-1">
                  <FieldLabel>Name</FieldLabel>
                  <input
                    value={form.name}
                    onChange={(e) => onFormChange({ name: e.target.value })}
                    placeholder="e.g. Fort Stevens State Park"
                    className="w-full rounded-rv-md border border-rv-border-hi bg-rv-surface px-2.5 py-2 text-[13px] text-rv-ink"
                  />
                </label>
                <button
                  type="button"
                  onClick={onSubmitAdd}
                  className="inline-flex cursor-pointer items-center gap-1.5 self-start rounded-rv-md border-none bg-rv-green-cta px-4 py-2 text-[13px] font-semibold text-rv-surface"
                >
                  <Check className="size-4" />
                  Save reservation
                </button>
              </div>
            )}

            <div className="flex flex-col gap-2.5">
              {stop.reservations.map((r) => {
                const cm = categoryMeta(r.type);
                const rd = resDates(r);
                return (
                  <div
                    key={r.id}
                    className="flex gap-3 rounded-rv-card border border-rv-border bg-rv-surface p-4"
                  >
                    <CategoryTile type={r.type} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[14px] font-bold text-rv-ink">{r.name}</span>
                        <span className="font-mono text-[14px] font-semibold text-rv-green-cta">
                          {r.cost != null ? money(r.cost) : ""}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[12px] text-rv-ink-faded">
                        <span
                          className="font-bold uppercase tracking-[0.06em]"
                          style={{ color: cm.color }}
                        >
                          {cm.cat}
                        </span>
                        <span className="uppercase tracking-[0.05em]">{r.type}</span>
                        {rd && (
                          <>
                            <span>·</span>
                            <span>{rd}</span>
                          </>
                        )}
                        {r.confirmationNumber && (
                          <>
                            <span>·</span>
                            <span>#{r.confirmationNumber}</span>
                          </>
                        )}
                        <span className="ml-0.5">
                          <Stars value={r.rating ?? 0} size={14} onSet={(n) => onResRating(r.id, n)} />
                        </span>
                      </div>
                      <textarea
                        value={r.notes ?? ""}
                        onChange={(e) => onResNote(r.id, e.target.value)}
                        onBlur={() => onCommitResNote(r.id)}
                        placeholder={
                          r.type === "campground" || r.type === "lodging"
                            ? "Favorite site #, gate code, avoid the sharp left at the entrance…"
                            : "Notes — what to remember, rebook or not…"
                        }
                        className="mt-2.5 min-h-[44px] w-full resize-y rounded-rv-md border border-rv-border-soft bg-rv-surface-alt px-2.5 py-2 text-[13px] leading-relaxed text-rv-ink-muted"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Ideas */}
          {stop.ideas.length > 0 && (
            <div>
              <h3 className="m-0 mb-3 text-[17px] font-bold text-rv-navy">Ideas</h3>
              <div className="flex flex-col gap-2">
                {stop.ideas.map((it) => {
                  const cm = categoryMeta("activity");
                  const isDone = it.status === "done";
                  const noteVisible = ideaNoteOpen.has(it.id) || !!(it.notes && it.notes.trim());
                  return (
                    <div
                      key={it.id}
                      className="flex flex-col gap-2 rounded-rv-md border border-rv-border bg-rv-surface px-3 py-2.5"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <cm.Icon className="size-[18px]" style={{ color: cm.color }} />
                        <span className="min-w-[120px] flex-1 text-[14px] text-rv-ink">{it.title}</span>
                        {isDone && (
                          <Stars value={it.rating ?? 0} size={14} onSet={(n) => onIdeaRating(it.id, n)} />
                        )}
                        <StatusPill status={it.status} onClick={() => onIdeaCycle(it.id)} />
                        {!isDone && (
                          <button
                            type="button"
                            onClick={() => onPromote(it.id)}
                            title="Promote to reservation"
                            className="inline-flex cursor-pointer items-center gap-1.5 border-none bg-transparent px-1.5 py-1 text-[13px] font-semibold text-rv-green-cta"
                          >
                            <CornerRightUp className="size-4" />
                            Book
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onIdeaToggleNote(it.id)}
                          title="Add a note"
                          className="inline-flex size-7 cursor-pointer items-center justify-center border-none bg-transparent p-0"
                          style={{
                            color: noteVisible
                              ? "var(--color-rv-green-cta)"
                              : "var(--color-rv-ink-subtle)",
                          }}
                        >
                          <SquarePen className="size-[17px]" />
                        </button>
                      </div>
                      {noteVisible && (
                        <textarea
                          value={it.notes ?? ""}
                          onChange={(e) => onIdeaNote(it.id, e.target.value)}
                          onBlur={() => onCommitIdeaNote(it.id)}
                          placeholder="Add a note — call ahead, what to remember…"
                          className="min-h-[38px] w-full resize-y rounded-rv-md border border-rv-border-soft bg-rv-surface-alt px-2.5 py-[7px] text-[13px] leading-relaxed text-rv-ink-muted"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Our take — the memory */}
          <div>
            <h3 className="m-0 mb-1 text-[17px] font-bold text-rv-navy">Our take</h3>
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

          {/* Stop total */}
          <div className="flex items-center justify-end gap-2 border-t border-rv-border-soft pt-4 font-mono text-[13px] text-rv-ink-faded">
            <Receipt className="size-4" />
            <span>Stop total</span>
            <span className="font-semibold text-rv-ink-muted">{money(costTotal)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
