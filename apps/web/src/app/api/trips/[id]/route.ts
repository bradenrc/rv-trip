import { NextResponse } from "next/server";
import { getTripById, getRigByOwner } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";
import { routeTrip } from "@/lib/routing";

/**
 * The trip bundle: the full tree PLUS the server-resolved drives, the rig hash
 * they were keyed with, and whether a rig exists. This is byte-for-byte the
 * payload `trips/[id]/page.tsx` hands `TripPlanner`, so the native app renders
 * the same drives the web does (issue #31 C1; schema `tripBundleSchema`).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const owner = getOwner();
  const trip = await getTripById(owner, id);
  if (!trip) return NextResponse.json({ error: "trip not found" }, { status: 404 });
  const rig = await getRigByOwner(owner);
  const { routes, rigHash } = await routeTrip(trip, rig);
  return NextResponse.json({ trip, routes, rigHash, hasRig: rig !== null });
}
