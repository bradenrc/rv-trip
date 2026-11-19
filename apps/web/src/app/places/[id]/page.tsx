import { notFound } from "next/navigation";
import { getOwner } from "@/lib/owner";
import { placeViewFor } from "@/lib/place-view";
import { PlaceView } from "@/components/places/PlaceView";
import PlacesPage from "../page";

export const dynamic = "force-dynamic";

/**
 * /places/[id] on a direct load (#197 · #196 · q4 A): the Places library, with
 * the Place view open over it, and ✕ goes to /places. The save is found in the
 * owner's own list; any other id — another household's, a deleted one — is
 * not-found.
 */
export default async function PlacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await placeViewFor(await getOwner(), id);
  if (!found) notFound();
  return (
    <>
      <PlacesPage />
      <PlaceView save={found.save} trip={found.trip} close="/places" />
    </>
  );
}
