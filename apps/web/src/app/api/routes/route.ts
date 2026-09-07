import { NextResponse } from "next/server";
import { z } from "zod";
import { getRigByOwner } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";
import { routePairs } from "@/lib/routing";

/**
 * The post-reorder upgrade. Drag a floating stop and you invent a pair the
 * server never routed; the client renders it immediately from the synchronous
 * estimate and asks here for the real thing. This is the one lazy piece of the
 * routing story, and only because reordering is not page load.
 *
 * Owner-scoped like every other handler: the rig is resolved from the CALLER,
 * never from the request body — a rig is a routing input, not a parameter a
 * client gets to choose.
 */
const point = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const bodySchema = z.object({
  pairs: z.array(z.object({ from: point, to: point })).min(1).max(50),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const owner = getOwner();
  const rig = await getRigByOwner(owner);
  return NextResponse.json(await routePairs(parsed.data.pairs, rig));
}
