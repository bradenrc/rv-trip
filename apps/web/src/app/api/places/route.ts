import { NextResponse } from "next/server";
import { savedPlaceCreate } from "@rv-trip/core";
import { createSave, listSavedPlacesForOwner } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";
import { placesProvider } from "@/lib/places";

/** The Places library, both shelves — `SavedPlace[]`. */
export async function GET() {
  return NextResponse.json(await listSavedPlacesForOwner(await getOwner()));
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
  // The destination is resolved HERE, where the provider is (#111): packages/db
  // holds no key, so the route hands `createSave` the live resolver — the stub
  // without GOOGLE_API_KEY, which anchors nothing — and the text search an
  // offline note's place suggestion comes from (i2 · Q3 A; the stub finds none).
  const { provider } = placesProvider();
  try {
    const { saved, replayed } = await createSave(await getOwner(), parsed.data, {
      resolveDestination: (lat, lng) => provider.resolveDestination(lat, lng),
      searchPlaces: (query, near) => provider.search(query, near),
    });
    // A replayed `clientId` is the phone re-sending a capture that already
    // landed: 200 with the row that exists, never a second row.
    return NextResponse.json(saved, { status: replayed ? 200 : 201 });
  } catch (e) {
    // The only guarded input is `tripId` — a trip this owner does not own.
    if (e instanceof Error && e.message === "trip not found") {
      return NextResponse.json({ error: "trip not found" }, { status: 404 });
    }
    throw e;
  }
}
