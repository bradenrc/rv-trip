import type { ReservationType } from "@rv-trip/core";
import {
  drillDoors,
  drillGroupLabel,
  drillMarkId,
  type DrillDoor,
  type DrillDoorId,
  type DrillGroup,
} from "./drill";

/**
 * The doors out (#82) — up to nine 30px targets under a research pad, grouped
 * google · social · <category>.
 *
 * Q1 → B: one white chip carrying the brand's own favicon at 16px, and a badge
 * — not a word — telling the Google trio apart (✦ AI Mode, ▦ Images, bare
 * search). The chip is a LIGHT ISLAND (`rv-light-island`): the mark is foreign
 * artwork drawn for a white backing and has no dark variant we are allowed to
 * make, so it keeps the contrast it was drawn for in both halves. The badge is
 * OURS, so it stays in the document half and flips with the app.
 *
 * Nothing in here fetches. The marks are build-time files under `markBase`
 * (`pnpm marks:drill`), and a door whose PNG is missing still renders its chip
 * — the `<img>`'s alt IS the monogram stand-in — and still navigates.
 *
 * The island wraps the chip's backing and the <img>, and nothing else: an
 * inline style reading `var(--color-rv-*)` (what `categoryMeta()` returns)
 * resolves the DOCUMENT half, never an island's, so no CategoryTile /
 * CategoryChip / `cm.Icon` may ever be placed inside one (entry.css:39-44).
 */

/** The monogram a door falls back to when its mark file is not there. */
const MONOGRAM: Record<DrillDoorId, string> = {
  google: "G",
  "google-ai": "G",
  "google-img": "G",
  reddit: "r",
  instagram: "ig",
  facebook: "f",
  dyrt: "D",
  campendium: "C",
  youtube: "▶",
  yelp: "y",
  alltrails: "A",
  tripadvisor: "t",
};

const GROUP_ORDER: DrillGroup[] = ["google", "social", "category"];

export function DrillRow({
  name,
  locality,
  type,
  markBase = "/drill",
}: {
  name: string;
  /** The town, when the caller has an honest one. See `DrillInput.locality`. */
  locality?: string | null;
  type: ReservationType;
  /** Where the build-time favicons are served from. The default is the path the
   * app publishes them at; the prop exists so packages/ui never hard-codes a
   * host app's public route. */
  markBase?: string;
}) {
  const doors = drillDoors({ name, locality, type });
  if (doors.length === 0) return null;
  const groups = GROUP_ORDER.map((group) => ({
    group,
    label: drillGroupLabel(group, type),
    doors: doors.filter((d) => d.group === group),
  })).filter((g) => g.doors.length > 0);

  return (
    <div>
      <div className="mb-2 mt-[15px] font-mono text-[10px] uppercase tracking-[0.1em] text-rv-ink-faded">
        Look it up
      </div>
      <div className="flex flex-wrap items-center gap-[18px]">
        {groups.map((g) => (
          <div key={g.group} className="flex items-center gap-1.5">
            <span className="mr-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-rv-ink-faded">
              {g.label}
            </span>
            {g.doors.map((door) => (
              <DrillDoorLink key={door.id} door={door} markBase={markBase} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function DrillDoorLink({ door, markBase }: { door: DrillDoor; markBase: string }) {
  return (
    <a
      href={door.url}
      target="_blank"
      rel="noreferrer"
      title={door.title}
      aria-label={door.title}
      className="group relative inline-flex size-[30px] items-center justify-center no-underline"
    >
      <span className="rv-light-island inline-flex size-[30px] items-center justify-center rounded-rv-md border border-rv-border-hi bg-rv-surface font-mono text-[13px] font-extrabold text-rv-ink group-hover:border-rv-accent-deep">
        {/* eslint-disable-next-line @next/next/no-img-element -- a 16px build-time
            mark under /public, not a content image: next/image is not a
            dependency of the design system. */}
        <img
          src={`${markBase}/${drillMarkId(door.id)}.png`}
          alt={MONOGRAM[door.id]}
          width={16}
          height={16}
          className="size-4"
        />
      </span>
      {door.badge && (
        <span className="absolute -bottom-[3px] -right-[3px] rounded-rv-pill bg-rv-accent-deep px-[3px] py-0.5 text-[8px] font-bold leading-none text-rv-accent-ink">
          {door.badge}
        </span>
      )}
    </a>
  );
}
