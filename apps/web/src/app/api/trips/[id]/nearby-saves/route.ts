import { NextResponse } from "next/server";
import { nearbySaves } from "@rv-trip/core";
import { getTripById, listDismissedSaveIds, listSavedPlacesForOwner } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";
import { nextTimeFor } from "@/lib/next-time";

/**
 * The saves near this trip (#111 i3 · docs/design/111 "Contracts"): what the
 * phone's banner counts and the review sheet lists. Three owner-scoped reads
 * and core's pure `nearbySaves` — the radius is the trip's own
 * (`surface_radius_mi`), null reading as the 50 mi default.
 *
 * #113 · the "Last time here" card's saves are left out HERE — the one seam
 * both the phone's banner and the web's refresh read — so a been save is
 * never counted in the card and the banner at once (vet HIGH).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const owner = await getOwner();
  const trip = await getTripById(owner, id);
  if (!trip) return NextResponse.json({ error: "trip not found" }, { status: 404 });
  const [saves, dismissed] = await Promise.all([
    listSavedPlacesForOwner(owner),
    listDismissedSaveIds(owner, id),
  ]);
  const nextTime = await nextTimeFor(owner, trip, saves);
  return NextResponse.json(nearbySaves(trip, saves, dismissed, trip.surfaceRadiusMi, nextTime.saveIds));
}
