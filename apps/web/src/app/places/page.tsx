import { listSavedPlacesForOwner, listTripsForOwner } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";
import { PlacesWorkspace } from "@/components/places/PlacesWorkspace";

export const dynamic = "force-dynamic";

export default async function PlacesPage() {
  const owner = getOwner();
  const [places, trips] = await Promise.all([
    listSavedPlacesForOwner(owner),
    listTripsForOwner(owner),
  ]);

  // The graduate sheet's "Visited on" list (docs/design/41 §5): complete trips
  // only, narrowed here to what the dropdown draws so the whole summary — days,
  // miles, open stops — does not cross into a client island to fill a <select>.
  const visitedOn = trips
    .filter((t) => t.status === "complete")
    .map((t) => ({ id: t.id, title: t.title }));

  // The header copy stays on the server; the island owns only the button beside
  // it, both sheets and the ⋯ menu.
  return (
    <main className="mx-auto w-full max-w-[1120px] px-7 pb-[72px] pt-9">
      <PlacesWorkspace places={places} trips={visitedOn}>
        <div>
          <div className="mb-2 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-rv-ember">
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
    </main>
  );
}
