"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { activeTrip, localIsoDate, type Trip } from "@rv-trip/core";
import { tzCookie } from "@/lib/tz";

type LandingTrip = Pick<Trip, "id" | "startDate" | "endDate">;

/**
 * `/`'s first-visit step (#173 · #172 · Q3 C). The server had no usable `tz`
 * cookie, so it could not know the browser's date: this writes the cookie (so
 * the next visit redirects on the server), picks the trip in progress by the
 * device's own date and replaces into it — else /places. Renders nothing.
 */
export function LandingStep({ trips }: { trips: LandingTrip[] }) {
  const router = useRouter();
  useEffect(() => {
    try {
      document.cookie = tzCookie(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
      // Cookies blocked: the client answer below still lands the visit.
    }
    const active = activeTrip(trips, localIsoDate());
    router.replace(active ? `/trips/${active.id}` : "/places");
  }, [router, trips]);
  return null;
}
