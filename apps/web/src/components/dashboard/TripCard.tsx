import Link from "next/link";
import {
  Pencil,
  CalendarCheck,
  CircleCheck,
  Calendar,
  CalendarDays,
  MapPin,
  Flag,
  Caravan,
  CircleAlert,
  ArrowRight,
  House,
  Route,
  MapPinned,
  Mountain,
  type LucideIcon,
} from "lucide-react";
import { Stars } from "@rv-trip/ui";
import type { TripSummary } from "@rv-trip/db";
import { fullRange } from "@/lib/trip-ui";

// ── trip-level status pill (planning / upcoming / traveled) ────────────────
const STATUS: Record<TripSummary["status"], { label: string; fg: string; bg: string; Icon: LucideIcon }> = {
  planning: { label: "Planning", fg: "var(--color-rv-warning)", bg: "var(--color-rv-warning-soft)", Icon: Pencil },
  upcoming: { label: "Upcoming", fg: "var(--color-rv-green)", bg: "var(--color-rv-green-soft)", Icon: CalendarCheck },
  complete: { label: "Traveled", fg: "var(--color-rv-ink-faded)", bg: "var(--color-rv-navy-soft)", Icon: CircleCheck },
};

function StatusPill({ status }: { status: TripSummary["status"] }) {
  const s = STATUS[status];
  return (
    <span
      className="inline-flex items-center gap-[5px] rounded-rv-pill px-[11px] py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.06em]"
      style={{ background: s.bg, color: s.fg }}
    >
      <s.Icon className="size-3" style={{ color: s.fg }} />
      {s.label}
    </span>
  );
}

function Chip({ Icon, children }: { Icon: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-[5px] font-mono text-[12px] text-rv-ink-faded">
      <Icon className="size-[13px] text-rv-green" />
      {children}
    </span>
  );
}

// Deterministic cover gradient per trip (real cover images are a later follow-up).
const COVERS = [
  ["#12332a", "#2f6b4c"],
  ["#3a2b22", "#8a5230"],
  ["#0a1520", "#284866"],
  ["#1d2b38", "#41586e"],
];
function coverFor(id: string): [string, string] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COVERS[h % COVERS.length] as [string, string];
}

function TripCover({ id, complete, h }: { id: string; complete: boolean; h: number }) {
  const [c0, c1] = coverFor(id);
  const GhostIcon = complete ? MapPinned : Route;
  return (
    <div
      className="relative overflow-hidden"
      style={{ height: h, background: `linear-gradient(135deg, ${c0}, ${c1})` }}
    >
      <div
        className="absolute inset-0"
        style={{
          opacity: 0.08,
          backgroundImage: "radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)",
          backgroundSize: "14px 14px",
        }}
      />
      <GhostIcon className="absolute" style={{ width: h * 0.5, height: h * 0.5, color: "rgba(255,255,255,.22)" }} />
      <Mountain className="absolute bottom-3 right-3.5 size-[30px]" style={{ color: "rgba(255,255,255,.4)" }} fill="currentColor" />
    </div>
  );
}

export function TripCard({ trip, feature = false }: { trip: TripSummary; feature?: boolean }) {
  const complete = trip.status === "complete";
  return (
    <Link
      href={`/trips/${trip.id}`}
      className={`trip-card flex overflow-hidden rounded-rv-card border border-rv-border bg-rv-surface ${
        feature ? "flex-row [grid-column:1/-1]" : "flex-col"
      }`}
    >
      <div className={feature ? "flex-[0_0_300px]" : ""}>
        <TripCover id={trip.id} complete={complete} h={feature ? 200 : 132} />
      </div>
      <div className={`flex min-w-0 flex-1 flex-col gap-3 ${feature ? "p-[24px_26px]" : "p-[16px_18px]"}`}>
        <div className="flex items-center justify-between gap-2.5">
          <StatusPill status={trip.status} />
          {complete && trip.rating != null && trip.rating > 0 && <Stars value={trip.rating} />}
        </div>
        <div>
          <h3
            className={`m-0 mb-[5px] font-extrabold tracking-[-0.01em] text-rv-ink ${feature ? "text-[26px]" : "text-[19px]"}`}
          >
            {trip.title}
          </h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12px] text-rv-ink-faded">
            <span className="inline-flex items-center gap-[5px]">
              <Calendar className="size-[13px] text-rv-green" />
              {fullRange(trip.startDate, trip.endDate)}
            </span>
            {trip.homeBase && (
              <span className="inline-flex items-center gap-[5px]">
                <House className="size-[13px] text-rv-green" />
                {trip.homeBase}
              </span>
            )}
          </div>
        </div>
        {complete && trip.note && (
          <p className="m-0 max-w-[58ch] text-[13.5px] italic leading-normal text-rv-ink-muted">“{trip.note}”</p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-4 pt-1.5">
          <Chip Icon={CalendarDays}>{trip.days} days</Chip>
          <Chip Icon={MapPin}>{trip.stops} stops</Chip>
          <Chip Icon={Flag}>{trip.legs} legs</Chip>
          <Chip Icon={Caravan}>{trip.miles} mi</Chip>
          {!complete && trip.open > 0 && (
            <span className="inline-flex items-center gap-[5px] font-mono text-[12px] text-rv-warning">
              <CircleAlert className="size-[13px]" />
              {trip.open} open days
            </span>
          )}
          {feature && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-[14px] font-bold text-rv-ember">
              Open planner
              <ArrowRight className="size-[15px]" />
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
