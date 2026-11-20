"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { DidItAnswers, Destination, SavePlaceForm, Trip } from "@rv-trip/core";
import {
  activeTrip,
  captureTarget,
  checkOffBody,
  checkOffUndo,
  emptySavePlaceForm,
  isFreeTextPick,
  journalToast,
  localIsoDate,
  matchingOpenIdea,
  pickedDidItBody,
  pickPlace,
  pickedFromSummary,
  placeOf,
  savePlaceBody,
  savedToast,
} from "@rv-trip/core";
import { tripApi } from "@/lib/trip-api";
import { browserAreaLabel } from "@/lib/area-label";
import type { CapturedDetail } from "@/lib/captured";
import { PlaceSheet } from "./PlaceSheet";

/** Tell the page under the sheet what changed (docs/design/176 §4). */
function emit(detail: CapturedDetail) {
  window.dispatchEvent(new CustomEvent("rv:captured", { detail }));
}

const failed = () => toast.error("That change didn't save — check your connection.");

/**
 * #176 i3 · + Capture on the web (#175 · Q7 B): the Places sheet in capture
 * mode, over whatever page you are on. Mounted by `Nav`, OUTSIDE both of its
 * `dark` <nav> islands, so the light-theme sheet does not inherit the chrome's
 * tokens or its z-20 stacking context (vet MED).
 *
 * Where it files is core's rule, computed in the browser on open: the trip
 * covering `localIsoDate()` from `GET /api/trips`, then `captureTarget` over
 * that trip's bundle. Fetched every open, so the date and the open-idea list
 * are never stale. Until both answer, the sheet is the no-trip form; when a
 * trip arrives it switches to Been here unless the switch was already touched
 * (the phone's rule, apps/mobile/app/capture.tsx).
 *
 * Been here: an open idea that names the place is checked off (PATCH,
 * `checkOffBody`), else a done idea is created (POST, `pickedDidItBody`, no
 * clientId). Want to go / no trip: today's library save (`savePlaceBody`).
 * The sheet closes, the URL never changes, and the page under it hears
 * `rv:captured`.
 *
 * #201 · `googlePlaceId` is a place already picked on a map (a Google
 * basemap business's Save, through Nav's `rv:capture`). The sheet opens with
 * it as the pick, the same `PlaceSummary` the smart field would have
 * returned, from `/api/places/details/[id]`; the status switch is capture's
 * own rule as ever. When details names nothing (no Places key, a retired id)
 * the sheet stays on the search field.
 */
export function CaptureSheet({
  onClose,
  googlePlaceId = null,
}: {
  onClose: () => void;
  googlePlaceId?: string | null;
}) {
  const [target, setTarget] = useState<{ trip: Trip; destination: Destination | null } | null>(null);
  const [form, setForm] = useState<SavePlaceForm>(emptySavePlaceForm);
  const [logging, setLogging] = useState(false);
  const [answers, setAnswers] = useState<DidItAnswers>({ rating: null, again: null, note: "" });
  const [saving, setSaving] = useState(false);
  const touched = useRef(false);
  /** The free-text pick's area label — asked once, as PlacesWorkspace does. */
  const [areaLabel, setAreaLabel] = useState<string | null>(null);
  const areaAsked = useRef(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const list = await tripApi.listTrips();
      const trip = activeTrip(list, localIsoDate());
      if (!trip) return;
      const bundle = await tripApi.getTrip(trip.id);
      const next = captureTarget([bundle.trip], localIsoDate());
      if (!live || !next) return;
      setTarget(next);
      if (!touched.current) setLogging(true);
    })().catch(() => {
      // No trip list is no trip: the sheet stays today's library save.
    });
    return () => {
      live = false;
    };
  }, []);

  // #201 · seed the pick from the map's place. A pick the reader already
  // made in the field wins: only an empty pick is filled.
  useEffect(() => {
    if (!googlePlaceId) return;
    let live = true;
    void tripApi.placeDetails(googlePlaceId).then((env) => {
      const hit = env.results[0];
      if (!live || !hit) return;
      setForm((f) => (f.picked ? f : pickPlace(f, pickedFromSummary(hit))));
    });
    return () => {
      live = false;
    };
  }, [googlePlaceId]);

  const changeForm = (next: SavePlaceForm) => {
    // The no-trip switch (Want to go · Been there) is a touch too.
    if (next.status !== form.status) touched.current = true;
    setForm(next);
    if (areaAsked.current || !isFreeTextPick(next.picked)) return;
    areaAsked.current = true;
    void browserAreaLabel().then(setAreaLabel);
  };

  const submitLog = async (t: { trip: Trip; destination: Destination | null }) => {
    const picked = form.picked;
    if (!picked || picked.name.trim() === "") return;
    const { trip, destination } = t;
    const copy = journalToast(trip.title);
    const ideas = destination ? destination.ideas : trip.ideas;
    const match = matchingOpenIdea(ideas, placeOf(picked));
    if (match) {
      const patch = checkOffBody(answers);
      const before = checkOffUndo(match);
      await tripApi.updateIdea(match.id, patch);
      emit({ kind: "idea-patch", tripId: trip.id, id: match.id, patch });
      toast.success(copy.title, {
        description: copy.sub,
        action: {
          label: "Undo",
          onClick: () => {
            tripApi
              .updateIdea(match.id, before)
              .then(() => emit({ kind: "idea-patch", tripId: trip.id, id: match.id, patch: before }))
              .catch(failed);
          },
        },
      });
      return;
    }
    const body = pickedDidItBody(
      { tripId: trip.id, destinationId: destination?.id ?? null },
      picked,
      answers,
    );
    const idea = await tripApi.createIdea(body);
    emit({ kind: "idea", tripId: trip.id, idea });
    toast.success(copy.title, {
      description: copy.sub,
      action: {
        label: "Undo",
        onClick: () => {
          tripApi
            .deleteIdea(idea.id)
            .then(() =>
              emit({ kind: "idea-removed", tripId: trip.id, id: idea.id, destinationId: idea.destinationId }),
            )
            .catch(failed);
        },
      },
    });
  };

  /** Want to go, Been there, or no trip: today's library save (POST /api/places). */
  const submitLibrary = async () => {
    const body = savePlaceBody(form, areaLabel);
    if (!body) return;
    const place = await tripApi.savePlace(body);
    emit({ kind: "place", place });
    const copy = savedToast(place);
    toast.success(copy.title, { description: copy.sub ?? undefined });
  };

  const submit = () => {
    setSaving(true);
    const write = target && logging ? submitLog(target) : submitLibrary();
    write
      .then(() => {
        setSaving(false);
        onClose();
      })
      .catch(() => {
        setSaving(false);
        failed();
      });
  };

  return (
    <PlaceSheet
      form={form}
      mode="save"
      saving={saving}
      onChange={changeForm}
      onSubmit={submit}
      onClose={onClose}
      capture={
        target
          ? {
              trip: { id: target.trip.id, title: target.trip.title },
              destination: target.destination
                ? { id: target.destination.id, name: target.destination.place.name }
                : null,
            }
          : null
      }
      logging={logging}
      answers={answers}
      onLogging={(on) => {
        touched.current = true;
        setLogging(on);
      }}
      onAnswers={setAnswers}
    />
  );
}
