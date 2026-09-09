import { NextResponse } from "next/server";
import { legReorderInput } from "@rv-trip/core";
import { reorderTripLegs } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/**
 * "Move leg up/down" sends the whole new order rather than a swap, so the
 * renumber is one transaction and two legs can never end up sharing a
 * sortOrder. Scoped on the trip (the ownership root); 404 when it is not the
 * caller's. Ids from another trip renumber nothing — each statement carries
 * `legs.tripId` too.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = legReorderInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    await reorderTripLegs(await getOwner(), id, parsed.data.order);
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "trip not found" }, { status: 404 });
  }
}
