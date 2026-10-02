import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeSavedPlacePatch, savedPlacePatch } from "@rv-trip/core";
import { NO_SUGGESTION, deleteSavedPlace, updateSavedPlaceFields } from "@rv-trip/db";
import { getActor, getOwner } from "@/lib/owner";
import { placesProvider } from "@/lib/places";

/**
 * One library row (docs/design/41 §3). PATCH is the edit sheet, the graduation
 * (want → been: status + rating + tripId on the SAME row, source cleared) and
 * the Locate coordinate backfill; DELETE is the hard delete behind the undo
 * toast. Both are owner-scoped by the mutation's WHERE, which returns the ids
 * it matched — another owner's id matches nothing, so it 404s rather than 200s
 * over a write that never happened.
 *
 * `ctx.params` is a Promise in Next 16 and must be awaited (the shipped pattern
 * is api/destinations/[id]/route.ts).
 *
 * #111 i2 · Q3 A: PATCH also takes `{ upgradeToSuggested: true }` (the save
 * becomes its suggested place and its area is re-resolved — through the
 * provider resolved HERE, as POST does) and `{ suggestedPlace: null }`
 * (Dismiss). Still 204 with no body, so a client refetches for the new
 * area. An upgrade on a save with no suggestion is a 409.
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
  const { provider } = placesProvider();
  let updated: boolean;
  try {
    updated = await updateSavedPlaceFields(
      await getOwner(),
      id,
      normalizeSavedPlacePatch(parsed.data),
      await getActor(),
      { resolveArea: (lat, lng) => provider.resolveArea(lat, lng) },
    );
  } catch (e) {
    if (e instanceof Error && e.message === NO_SUGGESTION) {
      return NextResponse.json({ error: NO_SUGGESTION }, { status: 409 });
    }
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
  if (!(await deleteSavedPlace(await getOwner(), id))) {
    return NextResponse.json({ error: "place not found" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
