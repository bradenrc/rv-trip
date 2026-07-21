import Link from "next/link";
import { Plus, PlusCircle } from "lucide-react";
import { listTripsForOwner } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";
import { TripCard } from "@/components/dashboard/TripCard";

export const dynamic = "force-dynamic";

function SectionHead({ kicker, title, count }: { kicker: string; title: string; count?: number }) {
  return (
    <div className="mb-4 flex items-baseline gap-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-rv-ink-subtle">{kicker}</div>
      <h2 className="m-0 text-[22px] font-extrabold text-rv-navy">{title}</h2>
      {count != null && <span className="font-mono text-[13px] text-rv-ink-faded">{count}</span>}
    </div>
  );
}

function NewTripTile({ label = "Start a new trip" }: { label?: string }) {
  return (
    <Link
      href="/trips/new"
      className="flex min-h-[280px] cursor-pointer flex-col items-center justify-center gap-2.5 rounded-rv-card border border-dashed border-rv-border-hi bg-transparent text-rv-ink-faded transition-colors hover:border-rv-green hover:text-rv-navy"
    >
      <PlusCircle className="size-[30px] text-rv-green" />
      <span className="text-[14px] font-semibold">{label}</span>
    </Link>
  );
}

export default async function Home() {
  const trips = await listTripsForOwner(getOwner());
  const planning = trips.filter((t) => t.status === "planning");
  const upcoming = trips.filter((t) => t.status === "upcoming");
  const traveled = trips.filter((t) => t.status === "complete");
  const empty = trips.length === 0;

  return (
    <main className="mx-auto w-full max-w-[1120px] px-7 pb-[72px] pt-9">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="mb-2 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-rv-green-cta">
            Your trips
          </div>
          <h1 className="m-0 text-[40px] font-extrabold leading-none tracking-[-0.02em] text-rv-navy">
            Where to next?
          </h1>
        </div>
        <Link
          href="/trips/new"
          className="inline-flex cursor-pointer items-center gap-[7px] rounded-rv-md border-none bg-rv-green-cta px-[18px] py-[11px] text-[14px] font-bold text-white"
        >
          <Plus className="size-[15px]" fill="currentColor" strokeWidth={2.5} />
          New trip
        </Link>
      </div>

      {empty ? (
        <div className="mx-auto max-w-[440px] pt-6">
          <NewTripTile label="Start your first trip" />
        </div>
      ) : (
        <>
          {planning.length > 0 && (
            <section className="mb-10">
              <SectionHead kicker="In progress" title="Planning now" />
              <div className="grid grid-cols-1 gap-4">
                {planning.map((t) => (
                  <TripCard key={t.id} trip={t} feature />
                ))}
              </div>
            </section>
          )}

          <section className="mb-10">
            <SectionHead kicker="Ahead" title="Upcoming" count={upcoming.length} />
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
              {upcoming.map((t) => (
                <TripCard key={t.id} trip={t} />
              ))}
              <NewTripTile />
            </div>
          </section>

          {traveled.length > 0 && (
            <section>
              <SectionHead kicker="Been there" title="Traveled" count={traveled.length} />
              <p className="m-0 mb-4 mt-[-6px] max-w-[64ch] text-[14px] text-rv-ink-muted">
                What you loved and the notes worth keeping — the seed for the next trip. Reopen any to
                revisit or clone.
              </p>
              <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
                {traveled.map((t) => (
                  <TripCard key={t.id} trip={t} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
