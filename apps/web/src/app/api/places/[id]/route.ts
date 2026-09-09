import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeSavedPlacePatch, savedPlacePatch } from "@rv-trip/core";
import { deleteSavedPlace, updateSavedPlaceFields } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/**
 * One library row (docs/design/41 §3). PATCH is the edit sheet, the graduation
 * (want → been: status + rating + tripId on the SAME row, source cleared) and
 * the Locate coordinate backfill; DELETE is the hard delete behind the undo
 * toast. Both are owner-scoped by the mutation's WHERE, which returns the ids
 * it matched — another owner's id matches nothing, so it 404s rather than 200s
 * over a write that never happened.
 *
 * `ctx.params` is a Promise in Next 16 and must be awaited (the shipped pattern
 * is api/stops/[id]/route.ts).
 */

/** A malformed id can never be a row, and `uuid` columns reject it at the
 * driver rather than the query — so it is a 404, not a 500. */
const placeId = z.string().uuid();

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!placeId.safeParse(id).success) {
    return NextResponse.json({ error: "place not found" }, { status: 404 });
  }
  const parsed = savedPlacePatch.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  let updated: boolean;
  try {
    updated = await updateSavedPlaceFields(
      getOwner(),
      id,
      normalizeSavedPlacePatch(parsed.data),
    );
  } catch {
    return NextResponse.json({ error: "trip not found" }, { status: 404 });
  }
  if (!updated) {
    return NextResponse.json({ error: "place not found" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!placeId.safeParse(id).success) {
    return NextResponse.json({ error: "place not found" }, { status: 404 });
  }
  if (!(await deleteSavedPlace(getOwner(), id))) {
    return NextResponse.json({ error: "place not found" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
