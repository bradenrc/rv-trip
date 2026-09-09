import { NextResponse } from "next/server";
import { z } from "zod";
import { reorderLegStops } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

const bodySchema = z.object({ order: z.array(z.string().uuid()) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    await reorderLegStops(await getOwner(), id, parsed.data.order);
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "leg not found" }, { status: 404 });
  }
}
