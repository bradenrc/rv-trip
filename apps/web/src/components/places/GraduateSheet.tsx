"use client";

import { useId } from "react";
import { RotateCcw } from "lucide-react";
import type { GraduateForm, SavedPlace } from "@rv-trip/core";
import { Stars } from "@rv-trip/ui";
import { cn } from "@/lib/utils";
import { SheetShell, SheetField, SHEET_INPUT } from "./SheetShell";

/**
 * "Been there" — docs/design/41 §5's graduation sheet. It moves the SAME
 * record: `status: want → been`, plus the rating and the trip, with "who told
 * you" cleared. It never creates a second row, which is the whole point of the
 * library having one status field instead of two shelves.
 *
 * The stars are the shipped `<Stars value onSet>` in its interactive mode
 * (click the current value to clear) — not restyled, not re-drawn.
 */
export function GraduateSheet({
  place,
  form,
  trips,
  saving,
  onChange,
  onSubmit,
  onClose,
}: {
  place: SavedPlace;
  form: GraduateForm;
  /** Complete trips only — you cannot have been somewhere on a trip that has
   * not happened. Resolved on the server by /places and passed down. */
  trips: { id: string; title: string }[];
  saving: boolean;
  onChange: (form: GraduateForm) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const ids = useId();

  return (
    <SheetShell
      kicker={place.place.name}
      title="Been there"
      hint="want → been"
      submitLabel="Move to Been there"
      submitDisabled={saving}
      onSubmit={onSubmit}
      onClose={onClose}
    >
      <SheetField label="How was it">
        <span>
          <Stars value={form.rating} size={22} onSet={(n) => onChange({ ...form, rating: n })} />
        </span>
      </SheetField>

      <SheetField label="Visited on" aside="· complete trips only" htmlFor={`${ids}-trip`}>
        <select
          id={`${ids}-trip`}
          value={form.tripId}
          onChange={(e) => onChange({ ...form, tripId: e.target.value })}
          className={SHEET_INPUT}
        >
          <option value="">No trip</option>
          {trips.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </SheetField>

      <SheetField label="Note" aside="— carried over, editable" htmlFor={`${ids}-note`}>
        <textarea
          id={`${ids}-note`}
          rows={3}
          value={form.note}
          onChange={(e) => onChange({ ...form, note: e.target.value })}
          className={cn(SHEET_INPUT, "min-h-[54px] resize-y leading-relaxed")}
        />
      </SheetField>

      <div className="flex items-start gap-[9px] rounded-rv-md border border-rv-border-hi bg-rv-navy px-3 py-[9px] text-[12.5px] text-rv-ink-muted">
        <RotateCcw className="mt-[3px] size-[13px] flex-none text-rv-green" />
        <span>
          One record, one status. <span className="font-mono">status: want → been</span>
          {place.source ? (
            <>
              {" · "}
              &ldquo;Heard from {place.source}&rdquo; is replaced by the rating and the trip.
            </>
          ) : null}
        </span>
      </div>
    </SheetShell>
  );
}
