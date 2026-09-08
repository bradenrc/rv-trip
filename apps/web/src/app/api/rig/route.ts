import { NextResponse } from "next/server";
import { z } from "zod";
import { getRigByOwner, upsertRig } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/**
 * The account's one rig. PUT because it is a singleton at a fixed URL and
 * saving it is idempotent — the first save inserts, every later one replaces.
 * Dimensions arrive METRIC at millimetre precision; the client does the
 * imperial conversion so the stored value is exact.
 */
const rigSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["motorhome", "trailer"]),
  heightMeters: z.number().positive().max(30),
  widthMeters: z.number().positive().max(30),
  lengthMeters: z.number().positive().max(60),
  grossWeightKg: z.number().positive().max(100_000),
  propaneOnBoard: z.boolean(),
});

export async function GET() {
  return NextResponse.json(await getRigByOwner(getOwner()));
}

export async function PUT(req: Request) {
  const parsed = rigSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const rig = await upsertRig(getOwner(), parsed.data);
  return NextResponse.json(rig);
}
