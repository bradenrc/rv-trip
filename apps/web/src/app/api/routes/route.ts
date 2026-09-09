import { NextResponse } from "next/server";
import { z } from "zod";
import { rigHash } from "@rv-trip/core";
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
 *
 * The response ECHOES the hash it keyed with. The caller keyed its lookup on
 * the rig as it was when the page rendered; if the rig has been edited since,
 * these keys are for a different rig and the caller must not merge them — it
 * would be a silent no-op that re-requests the same pairs on every reorder.
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
  const owner = await getOwner();
  const rig = await getRigByOwner(owner);
  const hash = await rigHash(rig);
  return NextResponse.json({ rigHash: hash, routes: await routePairs(parsed.data.pairs, rig, hash) });
}
