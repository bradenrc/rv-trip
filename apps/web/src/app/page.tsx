import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { activeTrip, isoDateInZone } from "@rv-trip/core";
import { listTripsForOwner } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";
import { TZ_COOKIE } from "@/lib/tz";
import { LandingStep } from "@/components/nav/LandingStep";

export const dynamic = "force-dynamic";

/**
 * The landing rule (#173 · #172 · Q3 C). `/` is not a page of its own: it lands
 * you in the trip in progress — the one whose dates cover today in the
 * browser's zone (`activeTrip`) — or, with none, in /places. The trips list
 * itself lives at /trips.
 *
 * "Today" is the browser's date, read from the `tz` cookie. With no cookie, or
 * one that is not a zone, the server cannot know it, so `LandingStep` answers
 * on the client (and writes the cookie for next time).
 */
export default async function Landing() {
  const owner = await getOwner();
  const [trips, jar] = await Promise.all([listTripsForOwner(owner), cookies()]);
  const tz = jar.get(TZ_COOKIE)?.value;
  const today = tz ? isoDateInZone(new Date(), tz) : null;
  if (today !== null) {
    const active = activeTrip(trips, today);
    redirect(active ? `/trips/${active.id}` : "/places");
  }
  return <LandingStep trips={trips.map(({ id, startDate, endDate }) => ({ id, startDate, endDate }))} />;
}
