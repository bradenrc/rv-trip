import { listSavedPlacesForOwner, listTripsWithStopsForOwner } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";
import { MapOverview } from "@/components/map/MapOverview";

export const dynamic = "force-dynamic";

export default async function MapPage() {
  const owner = getOwner();
  const [trips, places] = await Promise.all([
    listTripsWithStopsForOwner(owner),
    listSavedPlacesForOwner(owner),
  ]);

  return (
    <main className="mx-auto w-full max-w-[1120px] px-7 pb-[72px] pt-9">
      <div className="mb-2 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-rv-accent">
        Overview
      </div>
      <h1 className="m-0 text-[40px] font-extrabold leading-none tracking-[-0.02em] text-rv-ink">
        Map
      </h1>
      <p className="m-0 mb-4 mt-3 max-w-[58ch] text-[15px] leading-relaxed text-rv-ink-muted">
        Everywhere you&rsquo;ve been and everywhere you&rsquo;ve saved, on one map — visited stops,
        favorites, and routes across all your trips.
      </p>

      <MapOverview trips={trips} places={places} />
    </main>
  );
}
