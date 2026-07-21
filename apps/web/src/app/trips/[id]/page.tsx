import { notFound } from "next/navigation";
import { getTripById } from "@rv-trip/db";
import { TripPlanner } from "@/components/trip/TripPlanner";
import { getOwner } from "@/lib/owner";

// Hits the DB on every request; don't statically prerender.
export const dynamic = "force-dynamic";

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trip = await getTripById(getOwner(), id);
  if (!trip) notFound();
  return <TripPlanner trip={trip} />;
}
