import { NextResponse } from "next/server";
import { ideaPatchColumns, ideaPatchInput } from "@rv-trip/core";
import { deleteIdea, updateIdeaFields } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/**
 * The idea PATCH. The schema is core's `ideaPatchInput` — the same grammar the
 * card reads — rather than a second hand-rolled copy that could drift from it.
 *
 * `ideaPatchColumns` sits between the parse and the mutation because `ideas`
 * has no `place` column: it flattens the wire's nested place onto place_name /
 * lat / lng / google_place_id, and — the part that matters — it does that ONLY
 * when the body actually carried a `place` key. A status cycle, a rating and a
 * note save each send one field, and none of them may erase a located idea.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = ideaPatchInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  await updateIdeaFields(await getOwner(), id, ideaPatchColumns(parsed.data));
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
