import type { ComponentProps } from "react";
import type { ChangeHistoryRow, LastChange } from "@rv-trip/core";
import {
  BYLINE_CARET,
  BYLINE_CARET_OPEN,
  HISTORY_ROWS,
  HISTORY_TRUNCATED,
  bylineLabel,
  changeFieldLabel,
  changeStamp,
  changeValueLabel,
  historyTitle,
} from "./change-byline";

/**
 * "rated by Jess · Sep 12 ▸" (#78 · docs/design/81 §5) — one quiet mono line
 * under the thing that changed, and the whole affordance when it is closed.
 * Nothing at all on a thing nobody has ever rated or noted.
 *
 * It is a TRIGGER and nothing else. The popover it opens is the app's shadcn
 * one (`apps/web/src/components/ui/popover.tsx`), composed around this line by
 * `apps/web/src/components/history/ChangeBylinePopover.tsx`, because
 * `packages/ui` has neither radix nor a network: no DS component here fetches,
 * and adding a popover primitive to the kit is exactly what this item's
 * acceptance forbids. So the byline takes the ONE row the list read already
 * carries and hands the rest — the open state, the fetch, the portal — to the
 * app, the same seam `gline` and `picker` already use.
 *
 * ONE deliberate departure from §5's CSS: it paints the caret, the panel's
 * header and each row's field label in the SUBTLE ink, but the nightfall sweep
 * retired that token for text glyphs — it is empty stars, grips and disabled
 * icons only, and packages/core/src/theme/nightfall-tokens.test.ts:334 reds the
 * build otherwise. Those three take `rv-ink-faded`, the role table's "mono
 * kickers" colour, which is what the closed line already uses.
 */
export function ChangeByline({
  last,
  open = false,
  className,
  ...button
}: {
  /** The joined `lastChange` — null renders nothing. */
  last: LastChange | null;
  /** The app owns the popover, so it owns this: it only turns the caret. */
  open?: boolean;
} & Omit<ComponentProps<"button">, "children">) {
  const label = bylineLabel(last);
  if (label === null) return null;
  return (
    <button
      type="button"
      {...button}
      className={[
        "inline-flex cursor-pointer items-center gap-1.5 rounded-rv-sm border border-transparent bg-transparent py-0.5 pl-0 pr-[5px] font-mono text-[10.5px] text-rv-ink-faded",
        // Opened, the line becomes a chip so it is clear the panel under it
        // belongs to this row and not the next one.
        "data-[state=open]:border-rv-border data-[state=open]:bg-rv-surface-alt data-[state=open]:px-[7px]",
        className ?? "",
      ]
        .join(" ")
        .trim()}
    >
      {label}
      <span className="text-[9px] text-rv-ink-faded">
        {open ? BYLINE_CARET_OPEN : BYLINE_CARET}
      </span>
    </button>
  );
}

/**
 * What the opened byline shows — the last few changes, old → new, newest
 * first. The panel's own chrome (the rounded card, the border, the shadow)
 * belongs to the app's `PopoverContent`; this is only its contents.
 */
export function ChangeHistoryList({
  name,
  rows,
}: {
  /** The thing the history is about — "Astoria, OR". */
  name: string;
  /** `GET /api/history`'s answer. Empty until it arrives, which draws the
   * header alone rather than a spinner the size of the panel. */
  rows: ChangeHistoryRow[];
}) {
  return (
    <div>
      <div className="mb-2 font-mono text-[9.5px] font-semibold uppercase tracking-[0.11em] text-rv-ink-faded">
        {historyTitle(name)}
      </div>
      {rows.map((row, i) => (
        <div
          key={`${row.at}-${row.field}-${i}`}
          className="flex flex-wrap items-baseline gap-[9px] border-b border-rv-border-soft py-[5px] last:border-b-0"
        >
          <span className="w-[52px] flex-none font-mono text-[9px] uppercase tracking-[0.08em] text-rv-ink-faded">
            {changeFieldLabel(row.field)}
          </span>
          <span className="min-w-0 flex-1 basis-[150px] text-[12px] text-rv-ink-muted">
            {changeValueLabel(row.field, row.from)} →{" "}
            <b className="text-rv-ink">{changeValueLabel(row.field, row.to)}</b>
          </span>
          <span className="whitespace-nowrap font-mono text-[10.5px] text-rv-ink-faded">
            {row.memberName} · {changeStamp(row.at)}
          </span>
        </div>
      ))}
      {rows.length >= HISTORY_ROWS && (
        <div className="pt-1.5 font-mono text-[9.5px] text-rv-ink-faded">{HISTORY_TRUNCATED}</div>
      )}
    </div>
  );
}
