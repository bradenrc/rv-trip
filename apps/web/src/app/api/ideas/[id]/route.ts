import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteIdea, updateIdeaFields } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

const patchSchema = z.object({
  status: z.enum(["idea", "planned", "done"]).optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  await updateIdeaFields(await getOwner(), id, parsed.data);
  return new NextResponse(null, { status: 204 });
}

/**
 * An idea is the other LEAF: no cascade, so no confirm dialog — the client
 * removes it optimistically and offers the six-second undo, which re-POSTs the
 * row (with its status and note) rather than resurrecting this id.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const matched = await deleteIdea(await getOwner(), id);
  if (!matched) return NextResponse.json({ error: "idea not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
