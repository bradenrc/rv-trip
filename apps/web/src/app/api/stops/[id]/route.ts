import { NextResponse } from "next/server";
import { z } from "zod";
import { updateStopFields } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

const patchSchema = z.object({
  rating: z.number().int().min(1).max(5).nullable().optional(),
  notes: z.string().nullable().optional(),
  arriveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  departDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  await updateStopFields(getOwner(), id, parsed.data);
  return new NextResponse(null, { status: 204 });
}
