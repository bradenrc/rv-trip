import type { ReservationType } from "@rv-trip/core";
import { categoryMeta, type CategoryMeta } from "./category";

/**
 * The rounded, color-filled icon tile that marks a reservation/idea's category
 * (Stay / Eat / Do / Travel / Other). `sm` (30px) for list rows, `md` (38px)
 * for detail cards.
 *
 * Two doors, one lookup: a `type` resolves through `categoryMeta`, and a
 * pre-resolved `meta` is what the do/eat/stay vocabulary hands in through
 * `ideaCategoryMeta` (#80). Exactly one of the two is given.
 */
export type CategoryTileProps = { size?: "sm" | "md" } & (
  | { type: ReservationType; meta?: never }
  | { meta: CategoryMeta; type?: never }
);

export function CategoryTile({ type, meta, size = "sm" }: CategoryTileProps) {
  const cm = meta ?? categoryMeta(type!);
  const dims =
    size === "md"
      ? "size-[38px] rounded-rv-md"
      : "size-[30px] rounded-rv-sm";
  const icon = size === "md" ? "size-5" : "size-4";
  return (
    <span
      className={`inline-flex flex-none items-center justify-center ${dims}`}
      style={{ background: cm.bg, color: cm.color }}
    >
      <cm.Icon className={icon} />
    </span>
  );
}
