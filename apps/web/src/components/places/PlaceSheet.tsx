"use client";

import { useId } from "react";
import type { ReservationType, SavePlaceForm } from "@rv-trip/core";
import { SAVE_SHEET_TYPES, pickPlace, savePlaceBody } from "@rv-trip/core";
import { categoryMeta } from "@rv-trip/ui";
import { cn } from "@/lib/utils";
import { PlacePicker } from "./PlacePicker";
import { SheetShell, SheetField, SHEET_INPUT } from "./SheetShell";

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
}: {
  form: SavePlaceForm;
  mode: "save" | "edit";
  saving: boolean;
  onChange: (form: SavePlaceForm) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const ids = useId();
  const activeCat = categoryMeta(form.type).cat;

  return (
    <SheetShell
      kicker="Your places"
      title={mode === "save" ? "Save a place" : "Edit place"}
      hint={`saves to · ${form.status}`}
      submitLabel="Save to library"
      submitDisabled={saving || savePlaceBody(form) === null}
      onSubmit={onSubmit}
      onClose={onClose}
    >
      <SheetField label="Place">
        <PlacePicker
          value={form.picked}
          onChange={(picked) => onChange(pickPlace(form, picked))}
        />
      </SheetField>

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
