import { NextResponse } from "next/server";
import { z } from "zod";
import { findApiKeyById, revokeApiKey } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/**
 * Settings → API keys → Revoke (#162 · Q8 A). Any member may revoke any of
 * the household's keys. `revokeApiKey` is unscoped, so the row is loaded first
 * and anything that is not `getOwner()`'s household is a 404 — a foreign id
 * and a missing one read the same. Revoking a key that is already dead is a
 * no-op 204. Session auth only, like the mint.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "key not found" }, { status: 404 });
  }
  const row = await findApiKeyById(id);
  if (!row || row.householdId !== (await getOwner())) {
    return NextResponse.json({ error: "key not found" }, { status: 404 });
  }
  await revokeApiKey(id);
  return new NextResponse(null, { status: 204 });
}
