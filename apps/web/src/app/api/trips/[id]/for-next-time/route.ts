import { NextResponse } from "next/server";
import { getTripById, listSavedPlacesForOwner } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";
import { nextTimeFor } from "@/lib/next-time";

/**
 * "For next time" (#113 · #107, Q7 B · Q8 B): one "Last time here" card per
 * past trip × destination this trip goes back near — core's pure
 * `forNextTime` over three owner-scoped reads. The phone's Route lens draws it
 * above the nearby banner; the web computes the same function in its page.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const owner = await getOwner();
  const trip = await getTripById(owner, id);
  if (!trip) return NextResponse.json({ error: "trip not found" }, { status: 404 });
  const saves = await listSavedPlacesForOwner(owner);
  return NextResponse.json(await nextTimeFor(owner, trip, saves));
}
