import { listSavedPlacesForOwner, listTripsForOwner } from "@rv-trip/db";
import type { SavedPlace } from "@rv-trip/core";

/**
 * The Place view's server read (#197 · #196). There is no single-place GET:
 * `/api/places/[id]` has only PATCH and DELETE, so the save is looked up in the
 * owner's own list (`listSavedPlacesForOwner`, owner-scoped) — another
 * household's id is simply not in it. `null` → the page calls `notFound()`.
 *
 * The trip's dates ride along only when the save names a trip, for the Yours
 * block's "Bellingham · Nov 11–15 →".
 */
export async function placeViewFor(
  owner: string,
  id: string,
): Promise<{ save: SavedPlace; trip: { startDate: string; endDate: string } | null } | null> {
  const save = (await listSavedPlacesForOwner(owner)).find((p) => p.id === id) ?? null;
  if (!save) return null;
  if (!save.tripId) return { save, trip: null };
  const t = (await listTripsForOwner(owner)).find((x) => x.id === save.tripId) ?? null;
  return { save, trip: t ? { startDate: t.startDate, endDate: t.endDate } : null };
}
