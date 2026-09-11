import { notFound } from "next/navigation";
import { getTripById, getRigByOwner } from "@rv-trip/db";
import { TripPlanner } from "@/components/trip/TripPlanner";
import { getOwner } from "@/lib/owner";
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
  const { routes, routingHash, nav } = await routeTrip(trip, rig, { nav: true });

  return (
    <TripPlanner
      trip={trip}
      routes={routes}
      routingHash={routingHash}
      nav={nav}
      hasRig={rig !== null}
    />
  );
}
