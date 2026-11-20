import { notFound } from "next/navigation";
import { getOwner } from "@/lib/owner";
import { placeViewFor } from "@/lib/place-view";
import { PlaceView } from "@/components/places/PlaceView";

export const dynamic = "force-dynamic";

/**
 * /places/[id], intercepted (#197 · #196 · docs/design/197 §5): a soft
 * navigation from a pin card's "Open" or a Journal entry's › draws the Place
 * view over the page you were on, and ✕ is `router.back()`. A hard load of the
 * same URL is `app/places/[id]/page.tsx` instead.
 */
export default async function PlaceModal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await placeViewFor(await getOwner(), id);
  if (!found) notFound();
  return <PlaceView save={found.save} trip={found.trip} close="back" />;
}
