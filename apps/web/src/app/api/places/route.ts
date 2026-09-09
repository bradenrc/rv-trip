import { NextResponse } from "next/server";
import { savedPlaceCreate } from "@rv-trip/core";
import { createSavedPlace, listSavedPlacesForOwner } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/** The Places library, both shelves — `SavedPlace[]`. */
export async function GET() {
  return NextResponse.json(await listSavedPlacesForOwner(getOwner()));
}

/**
 * Save a place (docs/design/41 §3). The body is FLAT — `savedPlaceCreate`, not
 * the nested read shape `savedPlace` — and accepting a "Been there?" suggestion
 * posts here too, with `status: "been"` and no lat/lng, because the library row
 * does not exist yet.
 */
export async function POST(req: Request) {
  const parsed = savedPlaceCreate.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const saved = await createSavedPlace(getOwner(), parsed.data);
    return NextResponse.json(saved, { status: 201 });
  } catch {
    // The only guarded input is `tripId` — a trip this owner does not own.
    return NextResponse.json({ error: "trip not found" }, { status: 404 });
  }
}
