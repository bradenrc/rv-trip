import { Star } from "lucide-react";

/**
 * A 1–5 star rating row. Read-only when `onSet` is omitted; interactive (and
 * toggle-to-clear) when provided. Empty stars render as hollow outlines.
 */
export function Stars({
  value,
  size = 13,
  onSet,
}: {
  /** current rating, 0–5 (0 = unrated) */
  value: number;
  /** star glyph size in px */
  size?: number;
  /** when provided, stars become buttons; clicking the current value clears it */
  onSet?: (n: number) => void;
}) {
  return (
    <span className="inline-flex items-center gap-px">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= value;
        const star = (
          <Star
            style={{
              width: size,
              height: size,
              color: filled ? "var(--color-rv-accent)" : "var(--color-rv-ink-subtle)",
              fill: filled ? "var(--color-rv-accent)" : "transparent",
            }}
          />
        );
        return onSet ? (
          <button
            key={n}
            type="button"
            onClick={() => onSet(value === n ? 0 : n)}
            className="cursor-pointer border-none bg-transparent p-px leading-none"
            aria-label={`Rate ${n}`}
          >
            {star}
          </button>
        ) : (
          <span key={n} className="leading-none">
            {star}
          </span>
        );
      })}
    </span>
  );
}
