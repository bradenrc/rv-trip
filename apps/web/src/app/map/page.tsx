import { tripRig, type RouteMap } from "@rv-trip/core";
import {
  getPrefsByOwner,
  getRigByOwner,
  listSavedPlacesForOwner,
  listTripsWithStopsForOwner,
} from "@rv-trip/db";
import { getOwner } from "@/lib/owner";
import { routeTrip } from "@/lib/routing";
import { MapOverview } from "@/components/map/MapOverview";
import { PageShell } from "@/components/nav/PageShell";
import { unitsFromPrefs } from "@/lib/units";

export const dynamic = "force-dynamic";

export default async function MapPage() {
  const owner = await getOwner();
  const [trips, places, rig, prefs] = await Promise.all([
    listTripsWithStopsForOwner(owner),
    listSavedPlacesForOwner(owner),
    getRigByOwner(owner),
    getPrefsByOwner(owner),
  ]);
  // The account's display units, read beside the owner it is already scoped by
  // — so the arc labels render in the right unit with no flash and no island
  // has to become a preference consumer (lib/units.ts).
  const units = unitsFromPrefs(prefs);

  // The same seam trips/[id]/page.tsx already uses: HERE is server-side only,
  // so every drive is resolved HERE, before render, and handed down as one
  // plain keyed map. A trip you have already taken draws no arc (pins.ts), so
  // it is not routed either — nothing is billed for a drive nobody will see.
  // Each trip routes with the rig only when it brings one (#103 · `tripRig`),
  // so the keys carry one of two hashes — handed down PER TRIP rather than as
  // one shared hash (vet HIGH: a single hash left every rig-less trip's drives
  // unfindable). The keys differ by hash, so the maps still merge cleanly.
  const routed = await Promise.all(
    trips
      .filter((t) => t.status !== "complete")
      .map(async (t) => ({ id: t.id, ...(await routeTrip(t, tripRig(t, rig))) })),
  );
  const routes: RouteMap = Object.assign({}, ...routed.map((r) => r.routes));
  const routingHash: Record<string, string> = Object.fromEntries(
    routed.map((r) => [r.id, r.routingHash]),
  );

  return (
    <PageShell>
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

      <MapOverview
        trips={trips}
        places={places}
        routes={routes}
        routingHash={routingHash}
        units={units}
      />
    </PageShell>
  );
}
