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
import { nextTimeFor } from "@/lib/next-time";
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
  const prefs = await getPrefsByOwner(owner);
  const units = unitsFromPrefs(prefs);
  // The "Add from Places" entrance (#80 Q6 → A). The library is account-scoped
  // and already read server-side on /places; the trip screen reads it on the
  // SAME seam rather than inventing a client fetch, so picking a place is one
  // POST and not a round-trip to discover what there is to pick.
  const savedPlaces = await listSavedPlacesForOwner(owner);
  // #113 · #107 "Last time here": the past trips' Been saves near this one —
  // the same seam GET /api/trips/:id/for-next-time answers with. Its saves are
  // left out of the nearby banner below (and in the nearby route, so a refresh
  // agrees with this first paint).
  const nextTime = await nextTimeFor(owner, trip, savedPlaces);
  // #111 i4 · trip surfacing, on the SAME seam: the saves near this trip at
  // its radius, minus the ones dismissed here — core's `nearbySaves`, the very
  // function GET /api/trips/:id/nearby-saves answers with — so the banner is
  // in the first paint with no client fetch.
  const nearby = nearbySaves(
    trip,
    savedPlaces,
    await listDismissedSaveIds(owner, trip.id),
    trip.surfaceRadiusMi,
    nextTime.saveIds,
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
      nextTime={nextTime}
      // #126 · Q5 A — `trip` already carries the coalesced home base
      // (getTripById: trip override → household); the household's own is
      // handed down for Trip settings' "Use household default".
      householdHome={prefs?.homeBasePlace ?? null}
    />
  );
}
