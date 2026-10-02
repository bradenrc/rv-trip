"use client";

import { useEffect, useState } from "react";
import { House } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BLANK_TRIP_DRAFT,
  tripDayCount,
  tripDraftInput,
  withTripMode,
  type Place,
  type TripDraft,
  type UserPrefs,
} from "@rv-trip/core";
import { FieldLabel, RangePicker } from "@rv-trip/ui";
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

/**
 * /trips/new — three questions, in order, on one page (#103 · Q1 A).
 *
 * It opens with ONLY question 1. Picking how the trip moves reveals the rest,
 * and preselects the lodging a trip like that mostly uses (campgrounds for a
 * road trip, hotels otherwise) and — road trip only — "Yes, the rig comes". A
 * fly trip or a mix is never asked about the rig; its answer is stored as off.
 * Create stays disabled until a mode is picked (`tripDraftInput` is null).
 *
 * The create seeds one unnamed chapter server-side (POST /api/trips), so the planner
 * this redirects into always has a chapter header to hang "Add destination" on.
 *
 * #126 · #127 (docs/design/130 §4): the page now asks **Where to?** first (a
 * PlacePicker — the pick becomes the trip's area and one destination spanning
 * its dates), then **When** on the one `RangePicker`. "Starting from" is no
 * longer asked: the household home base renders as a quiet chip whose
 * "change" writes this trip's override.
 */
export default function NewTripPage() {
  const router = useRouter();
  const [draft, setDraft] = useState<TripDraft>(BLANK_TRIP_DRAFT);
  const [saving, setSaving] = useState(false);
  /** The household home base (#126 · Q5 A) — the chip's default. */
  const [household, setHousehold] = useState<Place | null>(null);
  const [changingHome, setChangingHome] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/prefs")
      .then((r) => (r.ok ? (r.json() as Promise<UserPrefs | null>) : null))
      .then((p) => {
        if (live) setHousehold(p?.homeBasePlace ?? null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const home = draft.homeBasePlace?.name ?? household?.name ?? null;

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
          <QuestionLabel n={1}>Where to?</QuestionLabel>
          <PlacePicker
            value={draft.area ?? null}
            onChange={(area) => set({ area })}
            placeholder="A town, a park, a region…"
          />
          <div className="mt-2">
            {changingHome ? (
              <div className="flex flex-col gap-1">
                <FieldLabel>Starting from · this trip</FieldLabel>
                <PlacePicker
                  value={draft.homeBasePlace}
                  onChange={(homeBasePlace) => set({ homeBasePlace })}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setChangingHome(true)}
                className="inline-flex cursor-pointer items-center gap-[5px] rounded-rv-pill border border-rv-border-hi bg-transparent px-[9px] py-[3px] font-mono text-[11px] text-rv-ink-muted"
              >
                <House className="size-3" />
                {home ? `from ${home} · your home base · change` : "no home base yet · set one"}
              </button>
            )}
          </div>
        </div>

        <div className="mb-4">
          <QuestionLabel n={2}>When</QuestionLabel>
          <RangePicker
            value={{ start: draft.startDate || null, end: draft.endDate || null }}
            onChange={(v) => set({ startDate: v.start ?? "", endDate: v.end ?? "" })}
          />
        </div>

        <div className="mb-4">
          <QuestionLabel n={3}>How does this trip mostly move?</QuestionLabel>
          <TripModeCards value={draft.mode} onChange={(m) => setDraft((d) => withTripMode(d, m))} />
        </div>

        {draft.mode === null ? (
          buttons
        ) : (
          <div className="ml-1 border-l-2 border-rv-border-hi pl-3.5">
            <div className="mb-4">
              <QuestionLabel n={4}>Where will you mostly sleep?</QuestionLabel>
              <LodgingCards
                mode={draft.mode}
                value={draft.lodgingDefault}
                onChange={(lodgingDefault) => set({ lodgingDefault })}
              />
            </div>

            {draft.mode === "road" && (
              <div className="mb-4">
                <QuestionLabel n={5}>Bringing the rig?</QuestionLabel>
                <RigCards value={draft.rigOn} onChange={(rigOn) => set({ rigOn })} />
              </div>
            )}

            <div className="flex flex-col gap-1">
              <FieldLabel>Trip name</FieldLabel>
              <Input
                value={draft.title}
                onChange={(e) => set({ title: e.target.value })}
                placeholder={draft.area?.name ?? "Redwoods Run"}
                className={FIELD}
              />
            </div>

            {buttons}
          </div>
        )}
      </div>
    </PageShell>
  );
}
