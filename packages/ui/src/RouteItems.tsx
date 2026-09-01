import type { ReservationType, IdeaStatus } from "@rv-trip/core";
import { CategoryTile } from "./CategoryTile";
import { StatusMarker } from "./StatusMarker";
import { money } from "./format";

/** A reservation as a compact row: category tile, name, right-aligned cost. */
export function ReservationLineItem({
  type,
  name,
  cost,
}: {
  type: ReservationType;
  name: string;
  cost: number | null;
}) {
  return (
    <div className="flex items-center gap-2.5 py-[7px]">
      <CategoryTile type={type} />
      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-rv-ink">{name}</span>
      <span className="w-[60px] flex-none text-right font-mono text-[13px] font-semibold text-rv-ember">
        {cost != null ? money(cost) : ""}
      </span>
    </div>
  );
}

/** An idea as a compact row: category tile, title, status marker. */
export function IdeaLineItem({
  type,
  title,
  status,
}: {
  type: ReservationType;
  title: string;
  status: IdeaStatus;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1">
      <CategoryTile type={type} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-rv-ink-muted">{title}</span>
      <StatusMarker status={status} />
    </div>
  );
}
