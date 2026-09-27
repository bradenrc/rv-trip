import { notFound } from "next/navigation";
import {
  getTripById,
  getRigByOwner,
  getPrefsByOwner,
  listDismissedSaveIds,
  listSavedPlacesForOwner,
} from "@rv-trip/db";
import { nearbySaves, tripRig } from "@rv-trip/core";
import { TripPlanner } from "@/components/trip/TripPlanner";
import { getOwner } from "@/lib/owner";
import { unitsFromPrefs } from "@/lib/units";
import { routeTrip } from "@/lib/routing";

// Hits the DB on every request; don't statically prerender.
export const dynamic = "force-dynamic";

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owner = await getOwner();
  const trip = await getTripById(owner, id);
  if (!trip) notFound();

  // HERE is server-side only and the client tree cannot await a vendor, so the
  // drives are resolved HERE, before render, and handed down as a keyed map.
  // `rig` itself stays on the server — the client only needs to know whether
  // one exists, so it can show the nudge.
  // `nav: true` — the corridor check is BILLABLE and per drive, so only a
  // screen that renders a Navigate control asks for it. /map does not
  // (docs/design/43 §4).
  const rig = await getRigByOwner(owner);
  // #103 · a trip that leaves the rig at home routes without it (klunk row 4).
  const { routes, routingHash, nav } = await routeTrip(trip, tripRig(trip, rig), { nav: true });
  // The account's display units, read on the SAME seam as the routes: the rail
  // and every drive row render in the right unit with no flash, and no display
  // component has to become a preference consumer (lib/units.ts).
  const units = unitsFromPrefs(await getPrefsByOwner(owner));
  // The "Add from Places" entrance (#80 Q6 → A). The library is account-scoped
  // and already read server-side on /places; the trip screen reads it on the
  // SAME seam rather than inventing a client fetch, so picking a place is one
  // POST and not a round-trip to discover what there is to pick.
  const savedPlaces = await listSavedPlacesForOwner(owner);
  // #111 i4 · trip surfacing, on the SAME seam: the saves near this trip at
  // its radius, minus the ones dismissed here — core's `nearbySaves`, the very
  // function GET /api/trips/:id/nearby-saves answers with — so the banner is
  // in the first paint with no client fetch.
  const nearby = nearbySaves(
    trip,
    savedPlaces,
    await listDismissedSaveIds(owner, trip.id),
    trip.surfaceRadiusMi,
  );

  return (
    <TripPlanner
      trip={trip}
      routes={routes}
      routingHash={routingHash}
      nav={nav}
      hasRig={rig !== null}
      units={units}
      savedPlaces={savedPlaces}
      nearby={nearby}
    />
  );
}
