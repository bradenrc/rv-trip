import { getTripForOwner } from "@rv-trip/db";
import { deriveDays, isScheduled, type DayCell, type Stop } from "@rv-trip/core";

// Hits the DB on every request; don't statically prerender.
export const dynamic = "force-dynamic";

const DEV_OWNER = "dev-user";

export default async function Home() {
  const trip = await getTripForOwner(DEV_OWNER);

  if (!trip) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold">No trip found</h1>
        <p className="mt-2 text-sm opacity-70">
          Run <code className="rounded bg-black/10 px-1">pnpm db:seed</code> to load the sample trip.
        </p>
      </main>
    );
  }

  const allStops: Stop[] = trip.legs.flatMap((l) => l.stops);
  const stopsById = new Map(allStops.map((s) => [s.id, s]));
  const { days, unscheduledStopIds } = deriveDays(trip, allStops);

  return (
    <main className="mx-auto max-w-4xl p-6 sm:p-10">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-widest opacity-50">Local dev · proof of wiring</p>
        <h1 className="mt-1 text-3xl font-semibold">{trip.title}</h1>
        <p className="mt-1 text-sm opacity-70">
          {trip.homeBase ? `${trip.homeBase} · ` : ""}
          {fmtRange(trip.startDate, trip.endDate)} · {days.length} days
        </p>
      </header>

      {/* Month-at-a-glance: the derived-days projection */}
      <section className="mb-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">Month at a glance</h2>
          <Legend />
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {days.map((d) => (
            <DayTile
              key={d.date}
              cell={d}
              stopName={d.stopId ? stopsById.get(d.stopId)?.place.name : undefined}
            />
          ))}
        </div>
      </section>

      {/* Route / sequence: legs -> stops */}
      <section className="space-y-6">
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">Route</h2>
        {trip.legs.map((leg) => (
          <div key={leg.id} className="rounded-xl border border-black/10 p-4 dark:border-white/10">
            <h3 className="mb-3 text-lg font-medium">{leg.title}</h3>
            <ul className="space-y-3">
              {leg.stops.map((s) => (
                <StopRow key={s.id} stop={s} />
              ))}
            </ul>
          </div>
        ))}
      </section>

      {unscheduledStopIds.length > 0 && (
        <p className="mt-6 text-xs opacity-60">
          {unscheduledStopIds.length} floating stop(s) not yet on the calendar — shown in the route with a “floating” badge.
        </p>
      )}
    </main>
  );
}

function DayTile({ cell, stopName }: { cell: DayCell; stopName?: string }) {
  const day = cell.date.slice(8);
  const styles: Record<DayCell["kind"], string> = {
    stay: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 border-emerald-500/30",
    drive: "bg-amber-500/20 text-amber-900 dark:text-amber-100 border-amber-500/40",
    empty: "bg-black/[0.03] text-black/40 dark:bg-white/5 dark:text-white/40 border-transparent",
  };
  return (
    <div className={`min-h-14 rounded-md border p-1.5 text-[11px] leading-tight ${styles[cell.kind]}`}>
      <div className="font-semibold">{day}</div>
      {cell.kind === "stay" && <div className="mt-0.5 truncate">{stopName}</div>}
      {cell.kind === "drive" && <div className="mt-0.5 font-medium">drive</div>}
    </div>
  );
}

function StopRow({ stop }: { stop: Stop }) {
  const scheduled = isScheduled(stop);
  return (
    <li className="flex flex-col gap-1 border-l-2 border-black/10 pl-3 dark:border-white/15">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{stop.place.name}</span>
        {scheduled ? (
          <span className="text-xs opacity-60">{fmtRange(stop.arriveDate!, stop.departDate!)}</span>
        ) : (
          <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">
            floating
          </span>
        )}
        {stop.rating != null && <Stars n={stop.rating} />}
      </div>
      {stop.notes && <p className="text-xs opacity-70">{stop.notes}</p>}
      {stop.reservations.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {stop.reservations.map((r) => (
            <span key={r.id} className="rounded bg-black/[0.06] px-2 py-0.5 text-[11px] dark:bg-white/10">
              {r.type} · {r.name}
              {r.cost != null ? ` · $${r.cost.toFixed(0)}` : ""}
            </span>
          ))}
        </div>
      )}
      {stop.ideas.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {stop.ideas.map((i) => (
            <span
              key={i.id}
              className="rounded-full border border-black/10 px-2 py-0.5 text-[11px] opacity-80 dark:border-white/15"
            >
              💡 {i.title} · {i.status}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span className="text-xs text-amber-500" aria-label={`${n} of 5 stars`}>
      {"★".repeat(n)}
      {"☆".repeat(5 - n)}
    </span>
  );
}

function Legend() {
  return (
    <div className="flex gap-3 text-[11px]">
      <span className="flex items-center gap-1">
        <i className="inline-block h-3 w-3 rounded-sm bg-amber-500/40" /> drive
      </span>
      <span className="flex items-center gap-1">
        <i className="inline-block h-3 w-3 rounded-sm bg-emerald-500/30" /> stay
      </span>
      <span className="flex items-center gap-1">
        <i className="inline-block h-3 w-3 rounded-sm bg-black/10 dark:bg-white/10" /> open
      </span>
    </div>
  );
}

function fmtRange(start: string, end: string) {
  const f = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  return `${f(start)} – ${f(end)}`;
}
