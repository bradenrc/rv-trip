"use client";

import { useId } from "react";
import type { DidItAnswers, ReservationType, SavePlaceForm } from "@rv-trip/core";
import {
  SAVE_SHEET_TYPES,
  didItContext,
  logCtaLabel,
  pickPlace,
  savePlaceBody,
  toggleAgain,
} from "@rv-trip/core";
import { SegmentedControl, Stars, categoryMeta } from "@rv-trip/ui";
import { cn } from "@/lib/utils";
import { PlacePicker } from "./PlacePicker";
import { SheetShell, SheetField, SHEET_INPUT } from "./SheetShell";

/**
 * #176 i3 · where a web capture files: the trip covering today and, when one
 * covers today, its destination (core's `captureTarget`, narrowed to what the
 * sheet draws). `null` means capture mode with no trip covering today.
 */
export interface CaptureContext {
  trip: { id: string; title: string };
  destination: { id: string; name: string } | null;
}

/**
 * "Save a place" — docs/design/41 §5, and the ⋯ menu's *Edit place* with the
 * same five fields against an existing row.
 *
 * Everything it decides lives in `@rv-trip/core`'s `place-form.ts` (which the
 * only test runner in the repo covers): what a picked place seeds, what the
 * flat POST body is, what the PATCH names. This file is the JSX over it.
 *
 * The category row resolves its icon, its label and both its colors through
 * `categoryMeta` — the five-category language is the DS's, and a sheet that
 * re-typed it would be the drift `packages/ui/src/category.ts` exists to stop.
 */
export function PlaceSheet({
  form,
  mode,
  saving,
  onChange,
  onSubmit,
  onClose,
  capture,
  logging = false,
  answers = NO_ANSWERS,
  onLogging,
  onAnswers,
}: {
  form: SavePlaceForm;
  mode: "save" | "edit";
  saving: boolean;
  onChange: (form: SavePlaceForm) => void;
  onSubmit: () => void;
  onClose: () => void;
  /**
   * #176 i3 · capture mode (+ Capture, from any page). Absent is the /places
   * sheet, unchanged. A context is mid-trip (Been here · Want to go); `null`
   * is a capture with no trip covering today (Want to go · Been there).
   */
  capture?: CaptureContext | null;
  /** Mid-trip only: Been here is selected, so the body is the journal's. */
  logging?: boolean;
  /** Been here's three optional answers. */
  answers?: DidItAnswers;
  onLogging?: (on: boolean) => void;
  onAnswers?: (a: DidItAnswers) => void;
}) {
  const ids = useId();
  const activeCat = categoryMeta(form.type).cat;
  const log = capture != null && logging;
  const picked = form.picked !== null && form.picked.name.trim() !== "";

  const place = (
    <SheetField label="Place">
      <PlacePicker
        value={form.picked}
        onChange={(picked) => onChange(pickPlace(form, picked))}
      />
    </SheetField>
  );

  // The status switch sits under Place in capture mode only. Mid-trip it is
  // Been here · Want to go (Want keeps the library form); outside a trip it is
  // the shipped Want to go · Been there, which `form.status` already holds.
  const status =
    capture === undefined ? null : capture === null ? (
      <div className="self-start">
        <SegmentedControl
          value={form.status}
          options={[
            { value: "want", label: "Want to go" },
            { value: "been", label: "Been there" },
          ]}
          onChange={(v) => onChange({ ...form, status: v })}
        />
      </div>
    ) : (
      <div className="self-start">
        <SegmentedControl
          value={logging ? "did" : "want"}
          options={[
            { value: "did", label: "Been here" },
            { value: "want", label: "Want to go" },
          ]}
          onChange={(v) => {
            onLogging?.(v === "did");
            if (v === "want" && form.status !== "want") onChange({ ...form, status: "want" });
          }}
        />
      </div>
    );

  if (log) {
    return (
      <SheetShell
        kicker={capture.trip.title}
        title="Capture"
        hint="saves to · journal"
        submitLabel={logCtaLabel(capture.trip.title)}
        submitTone="green"
        submitDisabled={saving || !picked}
        onSubmit={onSubmit}
        onClose={onClose}
      >
        {place}
        {status}
        <div className="-mt-2 font-mono text-[10.5px] text-rv-ink-faded">
          {didItContext(capture.trip.title, capture.destination?.name ?? null)}
        </div>

        <SheetField label="How was it">
          <Stars
            value={answers.rating ?? 0}
            size={26}
            onSet={(n) => onAnswers?.({ ...answers, rating: n === 0 ? null : n })}
          />
        </SheetField>

        <SheetField label="Do it again?">
          <AgainPair value={answers.again} onTap={(t) => onAnswers?.({ ...answers, again: toggleAgain(answers.again, t) })} />
        </SheetField>

        <SheetField label="Note" htmlFor={`${ids}-log-note`}>
          <textarea
            id={`${ids}-log-note`}
            rows={3}
            value={answers.note}
            placeholder="For next time…"
            onChange={(e) => onAnswers?.({ ...answers, note: e.target.value })}
            className={cn(SHEET_INPUT, "min-h-[54px] resize-y leading-relaxed")}
          />
        </SheetField>
      </SheetShell>
    );
  }

  return (
    <SheetShell
      kicker={capture ? capture.trip.title : "Your saves"}
      title={capture ? "Capture" : mode === "save" ? "Save a place" : "Edit place"}
      hint={`saves to · ${form.status}`}
      submitLabel="Save to library"
      submitDisabled={saving || savePlaceBody(form) === null}
      onSubmit={onSubmit}
      onClose={onClose}
    >
      {place}
      {status}

      <SheetField label="Category">
        <div className="flex flex-wrap gap-[7px]">
          {SAVE_SHEET_TYPES.map((t: ReservationType) => {
            const cm = categoryMeta(t);
            const on = cm.cat === activeCat;
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                // Already on this category (a "lodging" row under Stay) keeps
                // its own type — the row picks the category, not the type.
                onClick={() => onChange({ ...form, type: on ? form.type : t })}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-[5px] rounded-rv-pill border px-2.5 py-[5px] font-mono text-[11px] font-semibold uppercase tracking-[0.05em]",
                  !on && "border-rv-border-hi bg-transparent text-rv-ink-muted",
                )}
                style={on ? { background: cm.bg, color: cm.color, borderColor: cm.color } : undefined}
              >
                <cm.Icon className="size-3" />
                {cm.cat}
              </button>
            );
          })}
        </div>
      </SheetField>

      <SheetField label="Region" aside="— from the address, editable" htmlFor={`${ids}-region`}>
        <input
          id={`${ids}-region`}
          type="text"
          value={form.region}
          onChange={(e) => onChange({ ...form, region: e.target.value })}
          className={SHEET_INPUT}
        />
      </SheetField>

      {/* "Who told you" is queue metadata: §5 clears it on graduation, so a row
          already on the "been" shelf is not offered it back. */}
      {form.status === "want" ? (
        <SheetField label="Who told you" htmlFor={`${ids}-source`}>
          <input
            id={`${ids}-source`}
            type="text"
            value={form.source}
            onChange={(e) => onChange({ ...form, source: e.target.value })}
            className={SHEET_INPUT}
          />
        </SheetField>
      ) : null}

      <SheetField label="Note" htmlFor={`${ids}-note`}>
        <textarea
          id={`${ids}-note`}
          rows={3}
          value={form.note}
          onChange={(e) => onChange({ ...form, note: e.target.value })}
          className={cn(SHEET_INPUT, "min-h-[54px] resize-y leading-relaxed")}
        />
      </SheetField>
    </SheetShell>
  );
}

const NO_ANSWERS: DidItAnswers = { rating: null, again: null, note: "" };

/**
 * The web's "Do it again?" pair (#176 · Q4 A) — the phone's AgainPair as two
 * buttons. Tapping the lit one clears it (`toggleAgain`). Again lights in the
 * neutral ink tone, Once was enough in the warning tone.
 */
function AgainPair({ value, onTap }: { value: boolean | null; onTap: (tapped: boolean) => void }) {
  const base =
    "flex-1 cursor-pointer rounded-rv-md border-[1.5px] px-1 py-2 text-center text-[13px] font-semibold";
  const off = "border-rv-border-hi bg-rv-surface text-rv-ink-muted";
  return (
    <div className="flex gap-2">
      <button
        type="button"
        aria-pressed={value === true}
        onClick={() => onTap(true)}
        className={cn(base, value === true ? "border-rv-ink bg-rv-navy-soft text-rv-ink" : off)}
      >
        ↻ Again
      </button>
      <button
        type="button"
        aria-pressed={value === false}
        onClick={() => onTap(false)}
        className={cn(base, value === false ? "border-rv-warning bg-rv-warning-soft text-rv-warning" : off)}
      >
        ⊖ Once was enough
      </button>
    </div>
  );
}
