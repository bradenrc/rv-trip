import type { LucideIcon } from "lucide-react";
import {
  Tent,
  BedDouble,
  Utensils,
  Binoculars,
  Caravan,
  Ticket,
  Ellipsis,
  MapPin,
  CircleDashed,
  Clock,
  CircleCheck,
  Star,
} from "lucide-react";
import type { ReservationType, IdeaStatus, IsoDate, Place } from "@rv-trip/core";

/**
 * Category language (Stay / Eat / Do / Travel / Other) — a single lookup so
 * icons + colors stay consistent everywhere, mirroring the handoff's
 * `typeMeta`. Colors are CSS var strings (from the rv-* theme tokens) so they
 * can be used inline for the icon tiles that need exact fills / color-mix.
 */
export type CategoryLabel = "Stay" | "Eat" | "Do" | "Travel" | "Other";

export interface CategoryMeta {
  cat: CategoryLabel;
  Icon: LucideIcon;
  color: string;
  bg: string;
  ink: string;
}

const STAY = {
  color: "var(--color-rv-green-cta)",
  bg: "var(--color-rv-green-soft)",
  ink: "var(--color-rv-green-ink)",
} as const;
const EAT = {
  color: "var(--color-rv-warning)",
  bg: "var(--color-rv-warning-soft)",
  ink: "var(--color-rv-warning)",
} as const;
const DO = {
  color: "var(--color-rv-info-ink)",
  bg: "var(--color-rv-info-soft)",
  ink: "var(--color-rv-info-ink)",
} as const;
const TRAVEL = {
  color: "var(--color-rv-travel)",
  bg: "color-mix(in srgb, var(--color-rv-travel) 13%, var(--color-rv-surface))",
  ink: "var(--color-rv-travel-ink)",
} as const;
const OTHER = {
  color: "var(--color-rv-ink-faded)",
  bg: "var(--color-rv-surface-alt)",
  ink: "var(--color-rv-ink-muted)",
} as const;

export function categoryMeta(type: ReservationType): CategoryMeta {
  switch (type) {
    case "campground":
      return { cat: "Stay", Icon: Tent, ...STAY };
    case "lodging":
      return { cat: "Stay", Icon: BedDouble, ...STAY };
    case "dining":
      return { cat: "Eat", Icon: Utensils, ...EAT };
    case "tour":
    case "activity":
    case "event":
      return { cat: "Do", Icon: Binoculars, ...DO };
    case "transport":
      return { cat: "Travel", Icon: Caravan, ...TRAVEL };
    default:
      return { cat: "Other", Icon: type === "other" ? Ellipsis : MapPin, ...OTHER };
  }
}

export interface StatusMeta {
  Icon: LucideIcon;
  color: string;
}

export function statusMeta(status: IdeaStatus): StatusMeta {
  switch (status) {
    case "planned":
      return { Icon: Clock, color: "var(--color-rv-navy)" };
    case "done":
      return { Icon: CircleCheck, color: "var(--color-rv-green-cta)" };
    default:
      return { Icon: CircleDashed, color: "var(--color-rv-ink-subtle)" };
  }
}

/** Inline editable/read star row. */
export function Stars({
  value,
  size = 13,
  onSet,
}: {
  value: number;
  size?: number;
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
              color: filled ? "var(--color-rv-warning)" : "var(--color-rv-ink-subtle)",
              fill: filled ? "var(--color-rv-warning)" : "transparent",
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

// ── date formatting (plain YYYY-MM-DD, UTC — no tz drift) ──────────────────
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["S", "M", "T", "W", "T", "F", "S"];

function parts(d: IsoDate) {
  const [y, m, day] = d.split("-").map(Number);
  return { y: y!, m: m!, day: day! };
}
export function monthDay(d: IsoDate): string {
  const p = parts(d);
  return `${MONTHS[p.m - 1]} ${p.day}`;
}
export function weekdayLetter(d: IsoDate): string {
  const dt = new Date(`${d}T00:00:00Z`);
  return WD[dt.getUTCDay()]!;
}
/** "Aug 2–5" from a start/end; single day if equal. */
export function dateRange(start: IsoDate, end: IsoDate): string {
  const a = parts(start);
  const b = parts(end);
  if (start === end) return `${MONTHS[a.m - 1]} ${a.day}`;
  if (a.m === b.m) return `${MONTHS[a.m - 1]} ${a.day}–${b.day}`;
  return `${monthDay(start)} – ${monthDay(end)}`;
}
export function fullRange(start: IsoDate, end: IsoDate): string {
  const a = parts(start);
  const b = parts(end);
  const yr = b.y;
  if (a.m === b.m) return `${MONTHS[a.m - 1]} ${a.day} – ${b.day}, ${yr}`;
  return `${monthDay(start)} – ${monthDay(end)}, ${yr}`;
}
export function money(n: number): string {
  return "$" + n.toLocaleString("en-US");
}

// ── drive-time estimate (haversine at a nominal RV highway speed) ──────────
export function estimateDrive(
  from: Place,
  to: Place,
  avgKmh = 75,
): { label: string } | null {
  if (from.lat == null || from.lng == null || to.lat == null || to.lng == null) return null;
  const R = 6371;
  const dLat = deg(to.lat - from.lat);
  const dLng = deg(to.lng - from.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(deg(from.lat)) * Math.cos(deg(to.lat));
  const km = 2 * R * Math.asin(Math.sqrt(h));
  const miles = Math.round(km * 0.621371);
  const totalMin = Math.round((km / avgKmh) * 60);
  const h2 = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const time = h2 > 0 ? `${h2}h ${String(m).padStart(2, "0")}m` : `${m}m`;
  return { label: `~${time} · ${miles} mi` };
}
function deg(x: number): number {
  return (x * Math.PI) / 180;
}
