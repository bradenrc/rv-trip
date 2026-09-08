"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BLANK_TRIP_DRAFT, tripDayCount, tripDraftInput, type TripDraft } from "@rv-trip/core";
import { FieldLabel } from "@rv-trip/ui";
import { Input } from "@/components/ui/input";
import { tripApi } from "@/lib/trip-api";

/**
 * /trips/new — four fields, one of them optional.
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

  return (
    <main className="mx-auto w-full max-w-[1120px] px-7 pb-[72px] pt-9">
      <div className="max-w-[520px]">
        <div className="mb-0.5 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-rv-ember">
          New trip
        </div>
        <h1 className="m-0 mb-2 text-[32px] font-extrabold leading-none tracking-[-0.02em] text-rv-ink">
          Where to next?
        </h1>
        <p className="m-0 mb-4 max-w-[86ch] text-[13.5px] text-rv-ink-muted">
          Name it and set your dates. You can move everything later — stops don&apos;t need dates at
          all.
        </p>

        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-1">
            <FieldLabel>Trip name</FieldLabel>
            <Input
              value={draft.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="Redwoods Run"
              className="h-auto min-h-9 rounded-rv-md border-rv-border-hi bg-rv-navy-deep px-2.5 py-[7px] text-[13px] text-rv-ink md:text-[13px]"
            />
          </div>

          <div className="flex gap-2.5">
            <div className="flex flex-1 flex-col gap-1">
              <FieldLabel>Start</FieldLabel>
              <Input
                type="date"
                value={draft.startDate}
                onChange={(e) => set({ startDate: e.target.value })}
                className="h-auto min-h-9 rounded-rv-md border-rv-border-hi bg-rv-navy-deep px-2.5 py-[7px] font-mono text-[12px] text-rv-ink md:text-[12px]"
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <FieldLabel>End</FieldLabel>
              <Input
                type="date"
                value={draft.endDate}
                onChange={(e) => set({ endDate: e.target.value })}
                className="h-auto min-h-9 rounded-rv-md border-rv-border-hi bg-rv-navy-deep px-2.5 py-[7px] font-mono text-[12px] text-rv-ink md:text-[12px]"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <FieldLabel>
              Home base <span className="font-normal normal-case text-rv-ink-faded">optional</span>
            </FieldLabel>
            <Input
              value={draft.homeBase}
              onChange={(e) => set({ homeBase: e.target.value })}
              placeholder="Boise, ID"
              className="h-auto min-h-9 rounded-rv-md border-rv-border-hi bg-rv-navy-deep px-2.5 py-[7px] text-[13px] text-rv-ink md:text-[13px]"
            />
            <span className="text-[11.5px] text-rv-ink-faded">
              Free text for now — the place picker arrives with #23.
            </span>
          </div>

          <div className="mt-[5px] flex items-center gap-[9px]">
            <button
              type="button"
              onClick={create}
              disabled={!input || saving}
              className="cursor-pointer rounded-rv-md border-none bg-rv-ember px-3.5 py-[7px] text-[12.5px] font-bold text-rv-navy disabled:cursor-default disabled:opacity-45"
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
            {days !== null && (
              <span className="ml-auto font-mono text-[11.5px] text-rv-ink-faded">{days} days</span>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
