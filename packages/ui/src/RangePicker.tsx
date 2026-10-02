"use client"

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  dayCellState,
  isCompleteRange,
  monthGrid,
  monthOf,
  monthTitle,
  nightsLabel,
  pickDay,
  rangeLabel,
  rangePickState,
  shiftMonth,
  spanLabel,
  type DateRangeValue,
  type DateSpan,
} from "@rv-trip/core";

/**
 * RangePicker (#127 · Q6 A · Q7 B) — one picker for every date pair, with the
 * trip's own span always visible as a band.
 *
 * Replaces the native `<input type="date">` pairs in trip creation, the destination's
 * dates, Trip settings and the stay form. Outside days stay PICKABLE: a pick
 * that leaves the trip goes amber and offers "Extend trip to …", which hands
 * `onExtendTrip` the widened span — a guard, never a block. With no
 * `tripSpan` (trip creation) there is no band and no guard.
 *
 * Colour roles (docs/design/130 · dev notes): trip span `rv-navy-soft`, the
 * pick `rv-green` / `rv-green-soft`, outside the trip `rv-warning` /
 * `rv-warning-soft`. Two role-table adjustments (nightfall-tokens sweeps):
 * an outside EDGE is the amber ring on amber-soft (navy ink is legal only on
 * a green fill), and a day outside the band is `rv-ink-faded`, not the
 * non-text-only subtle ink. The arithmetic is core's `date-range.ts`, shared with the
 * phone twin (apps/mobile/src/ui.tsx `RangePicker`).
 */
export function RangePicker({
  value,
  tripSpan = null,
  onChange,
  onExtendTrip,
}: {
  value: DateRangeValue;
  /** The trip's own dates — the band, and the edge of the amber guard. */
  tripSpan?: DateSpan | null;
  onChange: (v: DateRangeValue) => void;
  /** "Extend trip to …" pressed: the trip span widened to hold the pick. */
  onExtendTrip?: (span: DateSpan) => void;
}) {
  const [month, setMonth] = useState(() =>
    monthOf(value.start ?? tripSpan?.start ?? new Date().toISOString().slice(0, 10)),
  );
  const complete = isCompleteRange(value) ? value : null;
  const state = complete ? rangePickState(complete, tripSpan) : null;

  return (
    <div className="w-full max-w-[380px] rounded-rv-card border border-rv-border bg-rv-surface px-3.5 py-3 shadow-rv-md">
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setMonth((m) => shiftMonth(m, -1))}
          className="inline-flex size-6 cursor-pointer items-center justify-center rounded-rv-sm border-none bg-transparent text-rv-ink-faded"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <b className="text-[14px] text-rv-ink">{monthTitle(month)}</b>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
          className="inline-flex size-6 cursor-pointer items-center justify-center rounded-rv-sm border-none bg-transparent text-rv-ink-faded"
        >
          <ChevronRight className="size-3.5" />
        </button>
        {tripSpan && (
          <span className="ml-auto font-mono text-[10.5px] text-rv-ink-faded">
            trip · {spanLabel(tripSpan)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5" role="grid" aria-label={monthTitle(month)}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="pb-1 text-center font-mono text-[9.5px] text-rv-ink-faded">
            {d}
          </div>
        ))}
        {monthGrid(month)
          .flat()
          .map((day, i) =>
            day === null ? (
              <div key={`b${i}`} className="h-8" />
            ) : (
              <DayCell
                key={day}
                day={day}
                value={value}
                tripSpan={tripSpan}
                onPick={() => onChange(pickDay(value, day))}
              />
            ),
          )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {complete && state ? (
          <>
            <span className="font-mono text-[13px] font-bold text-rv-ink">{rangeLabel(complete)}</span>
            <span className="font-mono text-[10.5px] text-rv-ink-faded">{nightsLabel(state.nights)}</span>
            {state.outsideDays > 0 ? (
              <span className="font-mono text-[10px] text-rv-warning">
                ⚠ {state.outsideDays} day{state.outsideDays === 1 ? "" : "s"} outside the trip
              </span>
            ) : state.wholeTrip ? (
              <span className="font-mono text-[10px] text-rv-green-ink">✓ whole trip</span>
            ) : null}
            {state.extendTo && onExtendTrip ? (
              <button
                type="button"
                onClick={() => onExtendTrip(state.extendTo!)}
                className="ml-auto inline-flex cursor-pointer items-center rounded-rv-pill border border-rv-warning bg-rv-warning-soft px-[9px] py-[3px] font-mono text-[9.5px] text-rv-warning"
              >
                Extend trip to {spanLabel(state.extendTo)}
              </button>
            ) : tripSpan && !state.wholeTrip ? (
              <button
                type="button"
                onClick={() => onChange({ start: tripSpan.start, end: tripSpan.end })}
                className="ml-auto inline-flex cursor-pointer items-center rounded-rv-pill border border-rv-border-hi bg-transparent px-[9px] py-[3px] font-mono text-[9.5px] text-rv-ink-muted"
              >
                Whole trip
              </button>
            ) : null}
          </>
        ) : (
          <span className="font-mono text-[11px] text-rv-ink-faded">
            {value.start ? "Pick the last day" : "Pick the first day"}
          </span>
        )}
      </div>

      {tripSpan && (
        <div className="mt-2 flex flex-wrap gap-3 font-mono text-[9.5px] text-rv-ink-faded">
          <span>
            <i className="mr-1 inline-block h-2.5 w-3.5 rounded-[2px] bg-rv-navy-soft align-middle" />
            the trip
          </span>
          <span>
            <i className="mr-1 inline-block h-2.5 w-3.5 rounded-[2px] bg-rv-green align-middle" />
            your pick
          </span>
          <span>
            <i className="mr-1 inline-block h-2.5 w-3.5 rounded-[2px] bg-rv-warning align-middle" />
            outside the trip (allowed)
          </span>
        </div>
      )}
    </div>
  );
}

function DayCell({
  day,
  value,
  tripSpan,
  onPick,
}: {
  day: string;
  value: DateRangeValue;
  tripSpan: DateSpan | null;
  onPick: () => void;
}) {
  const c = dayCellState(day, value, tripSpan);
  const tone = c.edge
    ? c.outside
      ? "rounded-rv-pill border-2 border-solid border-rv-warning bg-rv-warning-soft font-extrabold text-rv-warning"
      : "bg-rv-green font-extrabold text-rv-navy rounded-rv-pill"
    : c.picked
      ? c.outside
        ? "bg-rv-warning-soft text-rv-warning"
        : "bg-rv-green-soft text-rv-green-ink"
      : c.inTrip
        ? "bg-rv-navy-soft font-semibold text-rv-ink"
        : "bg-transparent text-rv-ink-faded";
  const caps = c.edge
    ? ""
    : `${c.tripStart ? "rounded-l-rv-pill" : ""} ${c.tripEnd ? "rounded-r-rv-pill" : ""}`;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={c.picked}
      aria-label={day}
      className={`flex h-8 cursor-pointer items-center justify-center border-none font-mono text-[12px] ${tone} ${caps}`}
    >
      {Number(day.slice(8, 10))}
    </button>
  );
}
