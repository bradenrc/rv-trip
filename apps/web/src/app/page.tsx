import { getTripForOwner } from "@rv-trip/db";
import { TripPlanner } from "@/components/trip/TripPlanner";

// Hits the DB on every request; don't statically prerender.
export const dynamic = "force-dynamic";

const DEV_OWNER = "dev-user";

export default async function Home() {
  const trip = await getTripForOwner(DEV_OWNER);

  if (!trip) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold">No trip found</h1>
        <p className="mt-2 text-sm opacity-70">
          Run <code className="rounded bg-black/10 px-1">pnpm db:seed</code> to load the sample trip.
        </p>
      </main>
    );
  }

  return <TripPlanner trip={trip} />;
}
