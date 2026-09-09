"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { FieldLabel } from "@rv-trip/ui";

/**
 * The chrome both /places sheets share (docs/design/41 §5) — scrim, right-hand
 * panel, sticky navy header with a kicker over the title, a scrolling body and
 * a footer that carries a mono hint plus Cancel and the primary action.
 *
 * It is the app's shipped sheet idiom (components/trip/StopDetailSheet.tsx:80-127)
 * factored out, deliberately NOT the unused shadcn `sheet.tsx`: the planner's
 * sheet is what the app already looks like, and a second sheet grammar on the
 * same product would be the drift this repo keeps out of the DS.
 */
export function SheetShell({
  kicker,
  title,
  hint,
  submitLabel,
  submitDisabled,
  onSubmit,
  onClose,
  children,
}: {
  kicker: string;
  title: string;
  /** The mono line in the footer — "saves to · want", "want → been". */
  hint: string;
  submitLabel: string;
  submitDisabled?: boolean;
  onSubmit: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
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
        <div className="sticky top-0 z-[1] bg-rv-navy px-6 py-5 text-rv-ink">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1.5 truncate font-mono text-[9px] uppercase tracking-[0.12em] text-rv-green-on-dark">
                {kicker}
              </div>
              <h2 className="m-0 text-[28px] font-extrabold tracking-[-0.02em] text-rv-ink">
                {title}
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
        </div>

        <div className="flex flex-col gap-[18px] p-6">{children}</div>

        <div className="mt-auto sticky bottom-0 flex items-center gap-2.5 border-t border-rv-border bg-rv-surface-alt px-6 py-4">
          <span className="font-mono text-[11px] text-rv-ink-faded">{hint}</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto inline-flex cursor-pointer items-center rounded-rv-md border border-rv-border-hi bg-transparent px-3 py-1.5 text-[13px] font-bold text-rv-ink-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitDisabled}
            className="inline-flex cursor-pointer items-center rounded-rv-md border-none bg-rv-ember px-3.5 py-2 text-[13px] font-bold text-rv-navy disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A labelled field — the DS `FieldLabel` (never a re-typed label style) plus
 * the optional mono aside §5 draws beside the auto-filled and carried-over
 * values ("— from the address, editable").
 *
 * `htmlFor` ties the label to a single control. The Place, Category and rating
 * fields hold a composite (a combobox with its listbox, a row of buttons, five
 * star buttons), which a `<label>` may not wrap — those pass no `htmlFor` and
 * label their own controls.
 */
export function SheetField({
  label,
  aside,
  htmlFor,
  children,
}: {
  label: string;
  aside?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  const head = (
    <>
      <FieldLabel>{label}</FieldLabel>
      {aside ? <span className="font-mono text-[11px] text-rv-ink-faded">{aside}</span> : null}
    </>
  );
  return (
    <div className="flex flex-col gap-1.5">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="flex flex-wrap items-baseline gap-1.5">
          {head}
        </label>
      ) : (
        <span className="flex flex-wrap items-baseline gap-1.5">{head}</span>
      )}
      {children}
    </div>
  );
}

/** The one text-input skin both sheets use. */
export const SHEET_INPUT =
  "w-full rounded-rv-md border border-rv-border-hi bg-rv-surface px-3 py-[9px] text-[13.5px] text-rv-ink outline-none focus:border-rv-green placeholder:text-rv-ink-faded";
