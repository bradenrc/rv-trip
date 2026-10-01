"use client";

import { useState } from "react";
import { Bed, MapPin, Minus, Plus, Search } from "lucide-react";
import {
  isScheduled,
  lodgingKindOfGoogle,
  nightsLabel,
  rangeNights,
  reservationDraftInput,
  searchAnchor,
  searchAnchorChip,
  stayDraft,
  stayKindChipLabel,
  stayKindIsFromGoogle,
  stayKindType,
  stepNights,
  orderedStops,
  withStayKind,
  type DateRangeValue,
  type LodgingKind,
  type PickedPlace,
  type ReservationDraft,
  type SearchAnchor,
  type Stop,
  type Trip,
} from "@rv-trip/core";
import { CategoryTile, FieldLabel, RangePicker, SegmentedControl } from "@rv-trip/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PlacePicker } from "@/components/places/PlacePicker";
import { KIND_OPTIONS } from "./stay-kinds";

/**
 * #128 · Q8 A · Q9 A — the name field of a stay IS an anchored search.
 *
 * The chip says where the search leans (#126's `searchAnchor`: this stop, else
 * the trip's destination, else it ASKS — never the caller's IP). Results are
 * lodging first; the list's last row, "Show all places, not just lodging",
 * drops the type. Shared by the Add stay sheet and the stop sheet's Stay form
 * (the Reservations Stay form "reuses it").
 */
export function StayPlaceField({
  value,
  anchor,
  onChange,
}: {
  value: PickedPlace | null;
  anchor: SearchAnchor | null;
  onChange: (p: PickedPlace | null) => void;
}) {
  const [allPlaces, setAllPlaces] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <PlacePicker
        value={value}
        onChange={onChange}
        near={anchor}
        type={allPlaces ? null : "lodging"}
        onShowAll={() => setAllPlaces(true)}
        placeholder="Search a hotel, campground, cabin…"
      />
      <span
        className={`inline-flex items-center gap-[5px] self-start rounded-rv-pill border px-[9px] py-[3px] font-mono text-[9.5px] ${
          anchor
            ? "border-rv-green bg-rv-green-soft text-rv-green-ink"
            : "border-rv-border-hi bg-transparent text-rv-ink-muted"
        }`}
      >
        <MapPin className="size-3" />
        {searchAnchorChip(anchor)}
      </span>
    </div>
  );
}

/** The stop a stay lands on when none was pressed: the first one with no stay
 * yet, else the first stop. */
function defaultStop(trip: Trip): Stop | null {
  const stops = orderedStops(trip);
  const bare = stops.find((s) => !s.reservations.some((r) => r.type === "lodging" || r.type === "campground"));
  return bare ?? stops[0] ?? null;
}

/**
 * The first-class Add stay sheet (#128 · Q8 A): two doors — Itinerary ▸ Add ▸
 * Stay (`stopId` null) and a stop card's "+ Add stay" (`stopId` set). Step 1
 * is the anchored lodging search; step 2 the dates, defaulting to the stop's
 * span with a nights stepper, then Save.
 */
export function AddStaySheet({
  trip,
  stopId,
  onClose,
  onSave,
  onSaveIdea,
}: {
  trip: Trip;
  /** The stop the stay is for; null → the sheet picks one (or makes one). */
  stopId: string | null;
  onClose: () => void;
  /** Resolves true when the stay landed. `stopId` null = no stop yet: the
   * caller creates one from the place and these dates first. */
  onSave: (input: {
    stopId: string | null;
    place: PickedPlace;
    /** The stay as the one reservation form holds it — the caller builds the
     * POST body with `reservationDraftInput` once the stop id is known. */
    draft: ReservationDraft;
  }) => Promise<boolean>;
  /** "Just considering? Save it as an idea instead." */
  onSaveIdea: (place: PickedPlace | null) => void;
}) {
  const stops = orderedStops(trip);
  const [targetId, setTargetId] = useState<string | null>(stopId ?? defaultStop(trip)?.id ?? null);
  const target = stops.find((s) => s.id === targetId) ?? null;
  const anchor = target
    ? searchAnchor(trip, { kind: "stop", stopId: target.id })
    : searchAnchor(trip, { kind: "trip" });
  const [picked, setPicked] = useState<PickedPlace | null>(null);
  // #144 · Q9 B — the kind is Google's when its type says lodging/campground,
  // else the trip's default; the chip says which, and opens the switch.
  const [kind, setKind] = useState<LodgingKind>(() => lodgingKindOfGoogle(null, trip.lodgingDefault));
  const [fromGoogle, setFromGoogle] = useState(false);
  const [kindOpen, setKindOpen] = useState(false);
  const pick = (p: PickedPlace | null) => {
    setPicked(p);
    setKind(lodgingKindOfGoogle(p?.primaryType, trip.lodgingDefault));
    setFromGoogle(stayKindIsFromGoogle(p?.primaryType));
    setKindOpen(false);
  };
  const friends = kind === "friends";
  const span = target && isScheduled(target)
    ? { start: target.arriveDate, end: target.departDate }
    : { start: trip.startDate, end: trip.endDate };
  const [range, setRange] = useState<DateRangeValue>(span);
  const [conf, setConf] = useState("");
  const [cost, setCost] = useState("");
  const [saving, setSaving] = useState(false);

  const complete = range.start !== null && range.end !== null ? { start: range.start, end: range.end } : null;
  const nights = complete ? rangeNights(complete.start, complete.end) : 0;
  const covers = complete && target && complete.start === target.arriveDate && complete.end === target.departDate;

  const draft: ReservationDraft | null =
    picked && complete
      ? {
          ...withStayKind(stayDraft(kind), kind),
          name: picked.name,
          checkIn: complete.start,
          checkOut: complete.end,
          // Friends has no paperwork (withStayKind) — the fields hide below.
          confirmationNumber: friends ? "" : conf,
          cost: friends ? "" : cost,
        }
      : null;
  // The same rule the POST body is built with disables Save.
  const input = draft ? reservationDraftInput(target?.id ?? "pending", draft) : null;

  const save = async () => {
    if (!picked || !draft || !input || saving) return;
    setSaving(true);
    const ok = await onSave({ stopId: target?.id ?? null, place: picked, draft });
    if (!ok) setSaving(false);
  };

  return (
    <Dialog open onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent className="gap-0 rounded-rv-card border border-rv-border-hi bg-rv-surface p-[18px] px-5 text-rv-ink shadow-rv-xl sm:max-w-[470px]">
        <DialogHeader className="gap-1.5">
          <DialogTitle className="flex items-center gap-[7px] text-[17px] font-extrabold text-rv-ink">
            <Bed className="size-4" />
            Add stay
            <span className="ml-auto font-mono text-[10.5px] font-normal text-rv-ink-faded">
              {picked ? "step 2 of 2" : (target?.place.name ?? trip.destination?.name ?? "")}
            </span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Search a place to stay, then its dates.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3 flex flex-col gap-2.5">
          {stops.length > 1 && stopId === null && (
            <label className="flex flex-col gap-1">
              <FieldLabel>For the stop</FieldLabel>
              <select
                value={targetId ?? ""}
                onChange={(e) => {
                  const next = stops.find((s) => s.id === e.target.value) ?? null;
                  setTargetId(next?.id ?? null);
                  if (next && isScheduled(next)) setRange({ start: next.arriveDate, end: next.departDate });
                }}
                className="h-auto min-h-9 rounded-rv-md border border-rv-border-hi bg-rv-navy-deep px-2.5 py-[7px] text-[13px] text-rv-ink"
              >
                {stops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.place.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {!picked ? (
            <>
              <StayPlaceField value={null} anchor={anchor} onChange={pick} />
              <button
                type="button"
                onClick={() => onSaveIdea(null)}
                className="cursor-pointer border-none bg-transparent p-0 text-center text-[11px] text-rv-ink-faded underline"
              >
                Just considering? Save it as an idea instead
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <CategoryTile type={stayKindType(kind)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-bold text-rv-ink">{picked.name}</div>
                  <div className="truncate font-mono text-[10px] text-rv-ink-faded">
                    {picked.address ?? target?.place.name ?? ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => pick(null)}
                  aria-label="Search again"
                  className="inline-flex cursor-pointer items-center border-none bg-transparent p-0 text-rv-ink-faded"
                >
                  <Search className="size-3.5" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => setKindOpen((o) => !o)}
                aria-expanded={kindOpen}
                className={`inline-flex cursor-pointer items-center gap-[5px] self-start rounded-rv-pill border px-[9px] py-[3px] font-mono text-[9.5px] ${
                  fromGoogle
                    ? "border-rv-green bg-rv-green-soft text-rv-green-ink"
                    : "border-rv-border-hi bg-transparent text-rv-ink-muted"
                }`}
              >
                {stayKindChipLabel(kind, fromGoogle)}
              </button>
              {kindOpen && (
                <div>
                  <SegmentedControl
                    value={kind}
                    options={KIND_OPTIONS}
                    onChange={(k) => {
                      setKind(k);
                      setFromGoogle(false);
                    }}
                  />
                </div>
              )}

              <FieldLabel>Check-in → check-out</FieldLabel>
              <RangePicker
                value={range}
                tripSpan={{ start: trip.startDate, end: trip.endDate }}
                onChange={setRange}
              />
              {complete && (
                <div className="flex items-center gap-2">
                  {covers ? (
                    <span className="font-mono text-[10px] text-rv-green-ink">
                      ✓ covers your whole stay at {target!.place.name}
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] text-rv-ink-faded">{nightsLabel(nights)}</span>
                  )}
                  <span className="ml-auto inline-flex items-center gap-[5px]">
                    <button
                      type="button"
                      aria-label="One night fewer"
                      onClick={() => setRange(stepNights(complete, -1))}
                      className="inline-flex size-[22px] cursor-pointer items-center justify-center rounded-rv-md border border-rv-border-hi bg-rv-navy-soft text-rv-ink"
                    >
                      <Minus className="size-3" />
                    </button>
                    <span className="min-w-[50px] text-center text-[10.5px] text-rv-ink">{nightsLabel(nights)}</span>
                    <button
                      type="button"
                      aria-label="One night more"
                      onClick={() => setRange(stepNights(complete, 1))}
                      className="inline-flex size-[22px] cursor-pointer items-center justify-center rounded-rv-md border border-rv-border-hi bg-rv-navy-soft text-rv-ink"
                    >
                      <Plus className="size-3" />
                    </button>
                  </span>
                </div>
              )}

              {!friends && (
                <>
                  <FieldLabel>Confirmation # · cost</FieldLabel>
                  <div className="flex gap-2">
                    <Input value={conf} onChange={(e) => setConf(e.target.value)} placeholder="optional" className="font-mono text-[12px]" />
                    <Input
                      value={cost}
                      onChange={(e) => setCost(e.target.value)}
                      inputMode="numeric"
                      placeholder="optional"
                      className="max-w-[110px] font-mono text-[12px]"
                    />
                  </div>
                </>
              )}

              <button
                type="button"
                onClick={() => void save()}
                disabled={!input || saving}
                className="mt-1 inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-rv-card border-none bg-rv-accent-deep px-3 py-[9px] text-[13px] font-extrabold text-rv-accent-ink disabled:cursor-default disabled:opacity-45"
              >
                Save stay
              </button>
              <button
                type="button"
                onClick={() => onSaveIdea(picked)}
                className="cursor-pointer border-none bg-transparent p-0 text-center text-[11px] text-rv-ink-faded underline"
              >
                Just considering? Save it as an idea instead
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
