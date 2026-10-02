"use client";

import { useState } from "react";
import { Plane } from "lucide-react";
import {
  blankHopDraft,
  boundaryFlightsBody,
  hopDraftZones,
  mirrorReturnDraft,
  type BoundaryFlightsBody,
  type HopBookingDraft,
  type Trip,
} from "@rv-trip/core";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PrefSwitch } from "@/components/ui/pref-switch";
import { FORM_FIELD_MONO, G3, SBTN, Field, ZoneRow } from "./HopCard";

/**
 * #129 · Q10 A — Add flight from Itinerary ▸ Add ▸ Flight: the trip's two
 * boundary hops, booked in ONE save. Round trip is ON by default (the web's
 * shipped `PrefSwitch`); the return leg opens with the outbound's airports
 * mirrored and the trip's last day, and the human types the flight and its
 * two times. Off, only the outbound is booked.
 *
 * Both legs are the hop form's own `HopBookingDraft`, so the airport → zone
 * chips, the "pick a zone" fallback and the local-time parsing are the ones the
 * hop card already ships.
 */
export function AddFlightSheet({
  trip,
  onClose,
  onSave,
}: {
  trip: Trip;
  onClose: () => void;
  /** Resolves true when both (or the one) landed. */
  onSave: (body: BoundaryFlightsBody) => Promise<boolean>;
}) {
  const area = trip.area?.name ?? trip.chapters.flatMap((l) => l.destinations)[0]?.place.name ?? "the trip";
  const [roundTrip, setRoundTrip] = useState(true);
  const [out, setOut] = useState<HopBookingDraft>(() => ({
    ...blankHopDraft("flight"),
    departs: `${trip.startDate} `,
    arrives: `${trip.startDate} `,
  }));
  const [back, setBack] = useState<HopBookingDraft>(() => mirrorReturnDraft(out, trip.endDate));
  const [backTouched, setBackTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const setOutbound = (patch: Partial<HopBookingDraft>) => {
    const next = { ...out, ...patch };
    setOut(next);
    // Until the return's own airports are typed, they follow the outbound's.
    if (!backTouched && ("from" in patch || "to" in patch || "fromZone" in patch || "toZone" in patch)) {
      setBack((b) => ({ ...b, from: next.to, to: next.from, fromZone: next.toZone, toZone: next.fromZone }));
    }
  };
  const setReturn = (patch: Partial<HopBookingDraft>) => {
    if ("from" in patch || "to" in patch) setBackTouched(true);
    setBack((b) => ({ ...b, ...patch }));
  };

  const body = boundaryFlightsBody(roundTrip, out, roundTrip ? back : null);
  const save = async () => {
    if (!body || saving) return;
    setSaving(true);
    const ok = await onSave(body);
    if (!ok) setSaving(false);
  };

  return (
    <Dialog open onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent className="gap-0 rounded-rv-card border border-rv-border-hi bg-rv-surface p-[18px] px-5 text-rv-ink shadow-rv-xl sm:max-w-[520px]">
        <DialogHeader className="gap-1.5">
          <DialogTitle className="flex items-center gap-[7px] text-[17px] font-extrabold text-rv-ink">
            <Plane className="size-4" />
            Add flight
            <span className="ml-auto font-mono text-[10.5px] font-normal text-rv-ink-faded">
              Home {roundTrip ? "⇄" : "→"} {area}
            </span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            The flight out and, with Round trip on, the flight home — one save.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3 flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <PrefSwitch checked={roundTrip} onChange={setRoundTrip} label="Round trip" />
            <span className="ml-auto font-mono text-[9.5px] text-rv-ink-faded">both hops</span>
          </div>

          <Leg title="Out" draft={out} onChange={setOutbound} />
          {roundTrip && (
            <>
              <Leg title="Return" draft={back} mirror onChange={setReturn} />
              <div className="font-mono text-[9.5px] text-rv-ink-faded">
                ↺ airports mirrored · return = trip’s last day · edit either later
              </div>
            </>
          )}

          <div className="flex flex-wrap items-center gap-[9px]">
            <button
              type="button"
              onClick={() => void save()}
              disabled={!body || saving}
              className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-rv-card border-none bg-rv-accent-deep px-3.5 py-[9px] text-[13px] font-extrabold text-rv-accent-ink disabled:cursor-default disabled:opacity-45"
            >
              {roundTrip ? "Save both flights" : "Save flight"}
            </button>
            <button type="button" onClick={onClose} className={SBTN}>
              Cancel
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Leg({
  title,
  draft,
  mirror = false,
  onChange,
}: {
  title: string;
  draft: HopBookingDraft;
  mirror?: boolean;
  onChange: (patch: Partial<HopBookingDraft>) => void;
}) {
  const zones = hopDraftZones(draft);
  return (
    <div
      className={`flex flex-col gap-2 rounded-rv-card border border-rv-border bg-rv-surface px-[9px] py-[7px] ${
        mirror ? "border-dashed" : ""
      }`}
    >
      <div className="font-mono text-[9px] uppercase text-rv-ink-faded">{title}</div>
      <div className={G3}>
        <Field label="Flight">
          <Input value={draft.label} onChange={(e) => onChange({ label: e.target.value })} placeholder="AS 2291" className={FORM_FIELD_MONO} />
        </Field>
        <Field label="From">
          <Input value={draft.from} onChange={(e) => onChange({ from: e.target.value, fromZone: null })} placeholder="BOI" className={FORM_FIELD_MONO} />
        </Field>
        <Field label="To">
          <Input value={draft.to} onChange={(e) => onChange({ to: e.target.value, toZone: null })} placeholder="BLI" className={FORM_FIELD_MONO} />
        </Field>
      </div>
      <div className={G3}>
        <Field label="Departs · local">
          <Input value={draft.departs} onChange={(e) => onChange({ departs: e.target.value })} placeholder="2026-10-10 07:05" className={FORM_FIELD_MONO} />
        </Field>
        <Field label="Arrives · local">
          <Input value={draft.arrives} onChange={(e) => onChange({ arrives: e.target.value })} placeholder="2026-10-10 08:10" className={FORM_FIELD_MONO} />
        </Field>
      </div>
      <ZoneRow draft={draft} zones={zones} kind="flight" onPick={onChange} />
    </div>
  );
}
