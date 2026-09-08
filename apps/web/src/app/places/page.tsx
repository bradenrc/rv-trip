import { Plus } from "lucide-react";
import { listSavedPlacesForOwner } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";
import { PlacesLibrary } from "@/components/places/PlacesLibrary";

export const dynamic = "force-dynamic";

export default async function PlacesPage() {
  const places = await listSavedPlacesForOwner(getOwner());

  return (
    <main className="mx-auto w-full max-w-[1120px] px-7 pb-[72px] pt-9">
      <div className="mb-[26px] flex flex-wrap items-end justify-between gap-5">
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
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-[7px] rounded-rv-md border-none bg-rv-accent-deep px-[18px] py-[11px] text-[14px] font-bold text-rv-accent-ink"
        >
          <Plus className="size-[15px]" fill="currentColor" strokeWidth={2.5} />
          Save a place
        </button>
      </div>

      <PlacesLibrary places={places} />
    </main>
  );
}
