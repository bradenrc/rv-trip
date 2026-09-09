"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import type {
  GraduateForm,
  PlaceSuggestion,
  SavedPlace,
  SavePlaceForm,
} from "@rv-trip/core";
import {
  applySavedPlacePatch,
  buildSuggestionShelf,
  editPlacePatch,
  emptySavePlaceForm,
  graduateFormFromSaved,
  graduatePatch,
  matchCandidateFromSaved,
  savePlaceBody,
  savePlaceFormFromSaved,
  savedPlaceToCreate,
  suggestionToCreate,
} from "@rv-trip/core";
import { tripApi } from "@/lib/trip-api";
import { PlacesLibrary } from "./PlacesLibrary";
import { PlaceCardMenu } from "./PlaceCardMenu";
import { PlaceSheet } from "./PlaceSheet";
import { GraduateSheet } from "./GraduateSheet";
import { SuggestedPlaceCard, SuggestionBar } from "./Suggestions";

/**
 * The /places client island — docs/design/41 §5.
 *
 * `app/places/page.tsx` is a `force-dynamic` server component, so the
 * handler-less "Save a place" button, both sheets and the ⋯ menu move here,
 * the same seam `map/page.tsx → MapOverview` already uses. The page's static
 * header copy stays on the server and arrives as `children`.
 *
 * **The refresh path** (the design left it unnamed): the island owns the list.
 * It seeds from the server render and then applies each write locally — the
 * created row the POST returns, `applySavedPlacePatch` for a PATCH, a splice
 * for a DELETE — exactly as `TripPlanner` does with a trip. No
 * `router.refresh()`: the sheets close onto the list they just changed, and a
 * full server round-trip would re-run every query on the page to move one card.
 */
export function PlacesWorkspace({
  places: initialPlaces,
  trips,
  suggestions = [],
  children,
}: {
  places: SavedPlace[];
  /** Complete trips only — the graduate sheet's "Visited on" list. */
  trips: { id: string; title: string }[];
  /** "Been there?" candidates — every stop and reservation rated ★4+ on a
   * complete trip (§7). De-duplication against the library happens here, not in
   * the query, so accepting one drops it on the next render. */
  suggestions?: PlaceSuggestion[];
  children: ReactNode;
}) {
  const [places, setPlaces] = useState(initialPlaces);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [saveSheet, setSaveSheet] = useState<{ id: string | null; form: SavePlaceForm } | null>(
    null,
  );
  const [gradSheet, setGradSheet] = useState<{ place: SavedPlace; form: GraduateForm } | null>(null);
  const [saving, setSaving] = useState(false);

  const failed = () => toast.error("That change didn't save — check your connection.");

  /**
   * The shelf, recomputed from the list the island already owns. `null` is the
   * whole empty state (Gap 3b): no bar, no cards, nothing announcing that
   * nothing is there. Accepting a suggestion needs no bookkeeping — the created
   * row lands in `places`, and `isAlreadySaved` then matches it.
   */
  const shelf = useMemo(
    () => buildSuggestionShelf(suggestions, places.map(matchCandidateFromSaved), dismissed),
    [suggestions, places, dismissed],
  );

  /** "Add to Been" — the library row does not exist yet, so this is a POST
   * carrying the rating and the trip it was visited on (§3). */
  const accept = (s: PlaceSuggestion) => {
    setSaving(true);
    tripApi
      .savePlace(suggestionToCreate(s))
      .then((saved) => {
        setPlaces((ps) => [...ps, saved]);
        setSaving(false);
      })
      .catch(() => {
        setSaving(false);
        failed();
      });
  };

  const submitSave = () => {
    if (!saveSheet) return;
    const { id, form } = saveSheet;
    setSaving(true);
    const done = () => {
      setSaving(false);
      setSaveSheet(null);
    };

    if (id === null) {
      const body = savePlaceBody(form);
      if (!body) return setSaving(false);
      tripApi
        .savePlace(body)
        .then((saved) => {
          setPlaces((ps) => [...ps, saved]);
          done();
        })
        .catch(() => {
          setSaving(false);
          failed();
        });
      return;
    }

    const patch = editPlacePatch(form);
    if (!patch) return setSaving(false);
    tripApi
      .updatePlace(id, patch)
      .then(() => {
        setPlaces((ps) => ps.map((p) => (p.id === id ? applySavedPlacePatch(p, patch) : p)));
        done();
      })
      .catch(() => {
        setSaving(false);
        failed();
      });
  };

  const submitGraduate = () => {
    if (!gradSheet) return;
    const { place, form } = gradSheet;
    const patch = graduatePatch(form);
    const tripName = trips.find((t) => t.id === patch.tripId)?.title ?? null;
    setSaving(true);
    tripApi
      .updatePlace(place.id, patch)
      .then(() => {
        setPlaces((ps) =>
          ps.map((p) => (p.id === place.id ? applySavedPlacePatch(p, patch, tripName) : p)),
        );
        setSaving(false);
        setGradSheet(null);
      })
      .catch(() => {
        setSaving(false);
        failed();
      });
  };

  /**
   * Delete is a hard delete (§3), so the undo toast re-saves the row rather
   * than un-deleting it: same content, new id. The card leaves the grid first
   * and comes back only if the server refuses, so the shelf never lies about
   * what the library holds.
   */
  const remove = (place: SavedPlace) => {
    setPlaces((ps) => ps.filter((p) => p.id !== place.id));
    tripApi
      .deletePlace(place.id)
      .then(() => {
        toast.success(`Deleted ${place.place.name}.`, {
          action: {
            label: "Undo",
            onClick: () => {
              tripApi
                .savePlace(savedPlaceToCreate(place))
                .then((saved) => setPlaces((ps) => [...ps, saved]))
                .catch(failed);
            },
          },
        });
      })
      .catch(() => {
        setPlaces((ps) => (ps.some((p) => p.id === place.id) ? ps : [...ps, place]));
        failed();
      });
  };

  return (
    <>
      <div className="mb-[26px] flex flex-wrap items-end justify-between gap-5">
        {children}
        <button
          type="button"
          onClick={() => setSaveSheet({ id: null, form: emptySavePlaceForm() })}
          className="inline-flex cursor-pointer items-center gap-[7px] rounded-rv-md border-none bg-rv-ember px-[18px] py-[11px] text-[14px] font-bold text-rv-navy"
        >
          <Plus className="size-[15px]" fill="currentColor" strokeWidth={2.5} />
          Save a place
        </button>
      </div>

      {shelf && (
        <SuggestionBar
          shelf={shelf}
          onDismissAll={() => setDismissed((d) => [...d, ...shelf.suggestions.map((s) => s.key)])}
        />
      )}

      <PlacesLibrary
        places={places}
        leading={shelf?.suggestions.map((s) => (
          <SuggestedPlaceCard
            key={s.key}
            suggestion={s}
            saving={saving}
            onDismiss={() => setDismissed((d) => [...d, s.key])}
            onAccept={() => accept(s)}
          />
        ))}
        cardMenu={(p) => (
          <PlaceCardMenu
            place={p}
            onEdit={() => setSaveSheet({ id: p.id, form: savePlaceFormFromSaved(p) })}
            onGraduate={() => setGradSheet({ place: p, form: graduateFormFromSaved(p) })}
            onDelete={() => remove(p)}
          />
        )}
      />

      {saveSheet ? (
        <PlaceSheet
          form={saveSheet.form}
          mode={saveSheet.id === null ? "save" : "edit"}
          saving={saving}
          onChange={(form) => setSaveSheet((s) => (s ? { ...s, form } : s))}
          onSubmit={submitSave}
          onClose={() => setSaveSheet(null)}
        />
      ) : null}

      {gradSheet ? (
        <GraduateSheet
          place={gradSheet.place}
          form={gradSheet.form}
          trips={trips}
          saving={saving}
          onChange={(form) => setGradSheet((s) => (s ? { ...s, form } : s))}
          onSubmit={submitGraduate}
          onClose={() => setGradSheet(null)}
        />
      ) : null}
    </>
  );
}
