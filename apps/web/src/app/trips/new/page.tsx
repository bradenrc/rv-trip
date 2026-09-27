"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BLANK_TRIP_DRAFT,
  tripDayCount,
  tripDraftInput,
  withTripMode,
  type TripDraft,
} from "@rv-trip/core";
import { FieldLabel } from "@rv-trip/ui";
import { PageShell } from "@/components/nav/PageShell";
import { PlacePicker } from "@/components/places/PlacePicker";
import { Input } from "@/components/ui/input";
import { tripApi } from "@/lib/trip-api";
import {
  LodgingCards,
  QuestionLabel,
  RigCards,
  TripModeCards,
} from "@/components/trip/choice-cards";

const FIELD =
  "h-auto min-h-9 rounded-rv-md border-rv-border-hi bg-rv-navy-deep px-2.5 py-[7px] text-[13px] text-rv-ink md:text-[13px]";
const FIELD_MONO =
  "h-auto min-h-9 rounded-rv-md border-rv-border-hi bg-rv-navy-deep px-2.5 py-[7px] font-mono text-[12px] text-rv-ink md:text-[12px]";

/**
 * /trips/new — three questions, in order, on one page (#103 · Q1 A).
 *
 * It opens with ONLY question 1. Picking how the trip moves reveals the rest,
 * and preselects the lodging a trip like that mostly uses (campgrounds for a
 * road trip, hotels otherwise) and — road trip only — "Yes, the rig comes". A
 * fly trip or a mix is never asked about the rig; its answer is stored as off.
 * Create stays disabled until a mode is picked (`tripDraftInput` is null).
 *
 * The create seeds one empty "Leg 1" server-side (POST /api/trips), so the
 * planner this redirects into always has a leg header to hang "Add stop" on.
 * There is no date picker in the app, so the dates are the native
 * `<input type="date">` rather than a new dependency.
 */
export default function NewTripPage() {
  const router = useRouter();
  const [draft, setDraft] = useState<TripDraft>(BLANK_TRIP_DRAFT);
  const [saving, setSaving] = useState(false);

  // One rule for "is this submittable": the body it would send, or null.
  const input = tripDraftInput(draft);
  const days = tripDayCount(draft.startDate, draft.endDate);
  const set = (patch: Partial<TripDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const create = async () => {
    if (!input || saving) return;
    setSaving(true);
    try {
      const trip = await tripApi.createTrip(input);
      router.push(`/trips/${trip.id}`);
    } catch {
      toast.error("Couldn't create that trip — nothing was saved.");
      setSaving(false);
    }
  };

  const buttons = (
    <div className="mt-3.5 flex flex-wrap items-center gap-[9px]">
      <button
        type="button"
        onClick={create}
        disabled={!input || saving}
        className="cursor-pointer rounded-rv-md border-none bg-rv-accent-deep px-3.5 py-[7px] text-[12.5px] font-bold text-rv-accent-ink disabled:cursor-default disabled:opacity-45"
      >
        {saving ? "Creating…" : "Create trip"}
      </button>
      <button
        type="button"
        onClick={() => router.push("/")}
        className="cursor-pointer rounded-rv-md border border-rv-border-hi bg-transparent px-3.5 py-[7px] text-[12.5px] font-semibold text-rv-ink"
      >
        Cancel
      </button>
      {draft.mode !== null && days !== null && (
        <span className="ml-auto font-mono text-[11.5px] text-rv-ink-faded">{days} days</span>
      )}
    </div>
  );

  return (
    <PageShell>
      <div className="max-w-[520px]">
        <div className="mb-0.5 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-rv-accent">
          New trip
        </div>
        <h1 className="m-0 mb-2 text-[32px] font-extrabold leading-none tracking-[-0.02em] text-rv-ink">
          Where to next?
        </h1>
        <p className="m-0 mb-4 max-w-[86ch] text-[13.5px] text-rv-ink-muted">
          Three quick answers shape the planner. You can change any of them later in Trip settings.
        </p>

        <div className="mb-4">
          <QuestionLabel n={1}>How does this trip mostly move?</QuestionLabel>
          <TripModeCards value={draft.mode} onChange={(m) => setDraft((d) => withTripMode(d, m))} />
        </div>

        {draft.mode === null ? (
          buttons
        ) : (
          <div className="ml-1 border-l-2 border-rv-border-hi pl-3.5">
            <div className="mb-4">
              <QuestionLabel n={2}>Where will you mostly sleep?</QuestionLabel>
              <LodgingCards
                mode={draft.mode}
                value={draft.lodgingDefault}
                onChange={(lodgingDefault) => set({ lodgingDefault })}
              />
            </div>

            {draft.mode === "road" && (
              <div className="mb-4">
                <QuestionLabel n={3}>Bringing the rig?</QuestionLabel>
                <RigCards value={draft.rigOn} onChange={(rigOn) => set({ rigOn })} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              <div className="col-span-2 flex flex-col gap-1">
                <FieldLabel>Trip name</FieldLabel>
                <Input
                  value={draft.title}
                  onChange={(e) => set({ title: e.target.value })}
                  placeholder="Redwoods Run"
                  className={FIELD}
                />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel>Start</FieldLabel>
                <Input
                  type="date"
                  value={draft.startDate}
                  onChange={(e) => set({ startDate: e.target.value })}
                  className={FIELD_MONO}
                />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel>End</FieldLabel>
                <Input
                  type="date"
                  value={draft.endDate}
                  onChange={(e) => set({ endDate: e.target.value })}
                  className={FIELD_MONO}
                />
              </div>
              <div className="col-span-2 flex flex-col gap-1">
                <FieldLabel>
                  Starting from{" "}
                  <span className="font-normal normal-case text-rv-ink-faded">optional</span>
                </FieldLabel>
                {/* The picker (#60): home base is a real place, so the first
                    stop of a trip can be searched near home. The rv-* names
                    re-resolve on the navy field surface as the Inputs do. */}
                <PlacePicker
                  value={draft.homeBasePlace}
                  onChange={(homeBasePlace) => set({ homeBasePlace })}
                />
              </div>
            </div>

            {buttons}
          </div>
        )}
      </div>
    </PageShell>
  );
}
