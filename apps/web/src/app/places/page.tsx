import { cookies } from "next/headers";
import { isoDateInZone, tripCard, tripNearInputs } from "@rv-trip/core";
import {
  getPrefsByOwner,
  listSavedPlacesForOwner,
  listSuggestionCandidatesForOwner,
  listTripsWithDestinationsForOwner,
} from "@rv-trip/db";
import { getOwner } from "@/lib/owner";
import { TZ_COOKIE } from "@/lib/tz";
import { PageShell } from "@/components/nav/PageShell";
import { PlacesWorkspace } from "@/components/places/PlacesWorkspace";
import { unitsFromPrefs } from "@/lib/units";

export const dynamic = "force-dynamic";

export default async function PlacesPage() {
  const owner = await getOwner();
  const [places, trips, suggestions, prefs, jar] = await Promise.all([
    listSavedPlacesForOwner(owner),
    // #186 i4 · #183: the full trees — the trip card counts a trip's unrated
    // stays, which the summary drops. The tree never crosses into the island.
    listTripsWithDestinationsForOwner(owner),
    // The "Been there?" candidates (§7) are fetched here, on the server, and
    // handed to the island whole; the island de-duplicates them against the
    // library it already holds, so accepting one needs no second query.
    listSuggestionCandidatesForOwner(owner),
    // #186 i2: Near you prints distances in the account's units, read here
    // beside the owner as map/page.tsx does (lib/units.ts).
    getPrefsByOwner(owner),
    cookies(),
  ]);
  const units = unitsFromPrefs(prefs);

  // The trip card (#183 · q5 A): "today" is the browser's date, read from the
  // tz cookie as the landing rule does (app/page.tsx). With no cookie yet the
  // server cannot know it, so that first load draws no card.
  const tz = jar.get(TZ_COOKIE)?.value;
  const today = tz ? isoDateInZone(new Date(), tz) : null;
  const card = today ? tripCard(trips, today) : null;

  // The graduate sheet's "Visited on" list (docs/design/41 §5): complete trips
  // only, narrowed here to what the dropdown draws so the whole summary — days,
  // miles, open destinations — does not cross into a client island to fill a <select>.
  const visitedOn = trips
    .filter((t) => t.status === "complete")
    .map((t) => ({ id: t.id, title: t.title }));

  // #186 i9 (#160 · q10 A): the save sheet's "Which trip?" input — complete
  // trips' id, title, dates and destination points. Slim, like visitedOn: the
  // island narrows it to the trips near the picked place.
  const nearTrips = tripNearInputs(trips);

  // The header copy stays on the server; the island owns only the button beside
  // it, both sheets and the ⋯ menu. #173 · #171: the library is "Places" again
  // (the nav label and this kicker); the URL stays /places.
  return (
    <PageShell>
      <PlacesWorkspace places={places} trips={visitedOn} card={card} suggestions={suggestions} units={units} nearTrips={nearTrips}>
        <div>
          <div className="mb-2 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-rv-accent">
            Your places
          </div>
          <h1 className="m-0 text-[40px] font-extrabold leading-none tracking-[-0.02em] text-rv-ink">
            Spots worth keeping
          </h1>
          <p className="m-0 mt-3 max-w-[58ch] text-[15px] leading-relaxed text-rv-ink-muted">
            A queue of places you&rsquo;ve heard about and an archive of the ones you&rsquo;ve been —
            the raw material for the next trip.
          </p>
        </div>
      </PlacesWorkspace>
    </PageShell>
  );
}
