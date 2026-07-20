import type { ReservationType } from "@rv-trip/core";
import { categoryMeta } from "./category";

/**
 * The rounded, color-filled icon tile that marks a reservation/idea's category
 * (Stay / Eat / Do / Travel / Other). `sm` (30px) for list rows, `md` (38px)
 * for detail cards.
 */
export function CategoryTile({
  type,
  size = "sm",
}: {
  type: ReservationType;
  size?: "sm" | "md";
}) {
  const cm = categoryMeta(type);
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
