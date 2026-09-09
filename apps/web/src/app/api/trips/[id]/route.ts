import { NextResponse } from "next/server";
import { orphanedStopsMessage, stopsOutsideRange, tripPatchInput } from "@rv-trip/core";
import { deleteTrip, getTripById, getRigByOwner, updateTripFields } from "@rv-trip/db";
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
  const owner = await getOwner();
  const trip = await getTripById(owner, id);
  if (!trip) return NextResponse.json({ error: "trip not found" }, { status: 404 });
  const rig = await getRigByOwner(owner);
  const { routes, rigHash } = await routeTrip(trip, rig);
  return NextResponse.json({ trip, routes, rigHash, hasRig: rig !== null });
}

/**
 * Edit a trip. 204 on success, 404 when the owner-scoped statement matches no
 * row, and 409 `date_range_orphans_stops` when the proposed range would leave a
 * scheduled stop outside it — `deriveDays` clamps to the trip window, so such a
 * stop would go invisible rather than wrong. That is the one refusal.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = tripPatchInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const owner = await getOwner();
  const patch = parsed.data;

  if (patch.startDate !== undefined || patch.endDate !== undefined) {
    const current = await getTripById(owner, id);
    if (!current) return NextResponse.json({ error: "trip not found" }, { status: 404 });
    const range = {
      startDate: patch.startDate ?? current.startDate,
      endDate: patch.endDate ?? current.endDate,
    };
    const orphans = stopsOutsideRange(
      range,
      current.legs.flatMap((l) => l.stops),
    );
    if (orphans.length) {
      return NextResponse.json(
        {
          error: "date_range_orphans_stops",
          message: orphanedStopsMessage(orphans),
          stops: orphans,
        },
        { status: 409 },
      );
    }
  }

  const matched = await updateTripFields(owner, id, patch);
  if (!matched) return NextResponse.json({ error: "trip not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}

/** Delete a trip. Legs, stops, reservations and ideas cascade with it. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const matched = await deleteTrip(await getOwner(), id);
  if (!matched) return NextResponse.json({ error: "trip not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
