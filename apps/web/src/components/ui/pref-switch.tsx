"use client";

/**
 * The one switch (issue #45 item 5).
 *
 * Lifted verbatim out of `TripPlanner`'s private `CostSwitch` at its shipped
 * metrics — 38×22, an 18px knob at left 2 / left 18, `bg-rv-green` on and
 * `bg-rv-border-hi` off — because the Settings page needs the same control and
 * the DS ships no Switch (`packages/ui/src/index.ts`). One implementation,
 * imported by both screens; `TripPlanner` keeps no private copy.
 *
 * `label` is what the two call sites differ on, and it is the only prop that
 * changes the shape:
 *
 *   · WITH a label (the planner's masthead) the whole row is one button — the
 *     13px text and the track together, exactly as it shipped.
 *   · WITHOUT one (the Settings row) it is a bare switch, because that row
 *     already draws its own 14px label and its helper line on the left and
 *     needs only the control on the right. `aria-label` then carries the name
 *     for anyone not reading the row.
 *
 * It lives in `components/ui/` rather than in `@rv-trip/ui` deliberately: a DS
 * component would have to be designed for every switch this app will ever have,
 * and this one is a lift, not a design.
 */
export function PrefSwitch({
  checked,
  onChange,
  label,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  /** Rendered inside the control, left of the track. Omit for a bare switch. */
  label?: string;
  /** Required when there is no visible `label`. */
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ? undefined : ariaLabel}
      onClick={() => onChange(!checked)}
      className="inline-flex cursor-pointer items-center gap-2 border-none bg-transparent p-0"
    >
      {label && (
        <span className={`text-[13px] font-semibold ${checked ? "text-rv-ink" : "text-rv-ink-faded"}`}>
          {label}
        </span>
      )}
      <span
        className={`relative h-[22px] w-[38px] flex-none rounded-full transition-colors ${
          checked ? "bg-rv-green" : "bg-rv-border-hi"
        }`}
      >
        <span
          className="absolute top-0.5 size-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.2)] transition-[left]"
          style={{ left: checked ? 18 : 2 }}
        />
      </span>
    </button>
  );
}
