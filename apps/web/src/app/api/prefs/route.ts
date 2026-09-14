import { NextResponse } from "next/server";
import { userPrefsPatch } from "@rv-trip/core";
import { getPrefsByOwner, upsertPrefs } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/**
 * The account's preferences (docs/design/45 §Q6, issue #38). Exactly the shape
 * `api/rig/route.ts` already uses: one singleton at a fixed URL, GET + PUT, both
 * scoped by `getOwner()` — which is the `dev-user` stub when Clerk is not
 * configured, so this works unchanged in a keyless walk.
 *
 * GET may answer `null`: an account that has never chosen anything has no row,
 * and the product defaults stand. That is not a 404 — nothing is missing.
 *
 * PUT takes a PARTIAL and never a whole row. Every write-through in
 * `lib/pref.ts` carries the ONE preference that just changed, so a theme toggle
 * cannot overwrite a units choice that another device made a moment ago. The
 * schema is `.strict()`, so a body naming `ownerId` (or any field this build
 * does not have) is a 400 rather than a quiet no-op.
 */
export async function GET() {
  return NextResponse.json(await getPrefsByOwner(await getOwner()));
}

export async function PUT(req: Request) {
  const parsed = userPrefsPatch.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const prefs = await upsertPrefs(await getOwner(), parsed.data);
  return NextResponse.json(prefs);
}
