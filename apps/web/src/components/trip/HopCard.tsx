"use client";

import { useState } from "react";
import { Car, Check, CircleAlert, Plane, Plus, Ship, Trash2 } from "lucide-react";
import {
  blankHopDraft,
  fixHopDraftDates,
  formatDriveTime,
  hopBookingClash,
  hopBookingInput,
  hopClashCopy,
  hopDraftZones,
  instantToLocal,
  localToInstant,
  minutesBetween,
  zoneChoices,
  type HopBookingDraft,
  type Place,
  type ReservationCreateInput,
  type TravelMode,
  type Trip,
  type ZoneChip,
} from "@rv-trip/core";
import { CategoryTile, FieldLabel, SegmentedControl, categoryMeta } from "@rv-trip/ui";
import type { RouteHop, RouteHopBooking } from "@/lib/trip-logic";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { MENU_ITEM_WARN, MenuHint, RowMenu } from "./row-menu";

/**
 * A non-drive hop on the Route lens (#104) — the travel card: the drive
 * card's structural accent (a 3px rv-travel left rule) on its fly and ferry
 * siblings. It carries the hop's bookings in LOCAL time with their zones, the
 * layovers between them, the DS `SegmentedControl` (mono) mode switch, and the
 * inline Add flight / Add ferry form (Q5 A).
 */

export const MODE_OPTIONS = [
  { value: "drive" as const, label: "Drive", Icon: Car },
  { value: "fly" as const, label: "Fly", Icon: Plane },
  { value: "ferry" as const, label: "Ferry", Icon: Ship },
];

/** The mono Drive / Fly / Ferry switch — the DS SegmentedControl as it ships. */
export function HopModeSwitch({
  value,
  onChange,
}: {
  value: TravelMode;
  onChange: (m: TravelMode) => void;
}) {
  return <SegmentedControl mono value={value} options={MODE_OPTIONS} onChange={onChange} />;
}

export interface HopCardActions {
  onMode: (segmentId: string, mode: TravelMode) => void;
  onOpenForm: (segmentId: string | null) => void;
  /** Resolves true when the booking landed (the form then closes). */
  onSave: (body: ReservationCreateInput, moveStop: boolean) => Promise<boolean>;
  onDelete: (resId: string) => void;
}

export function HopCard({
  hop,
  trip,
  flush,
  formOpen,
  actions,
}: {
  hop: RouteHop;
  trip: Trip;
  /** A hop to or from home sits flush with the leg, not indented under a stop. */
  flush: boolean;
  formOpen: boolean;
  actions: HopCardActions;
}) {
  const ModeIcon = hop.mode === "ferry" ? Ship : Plane;
  const kind = hop.mode === "ferry" ? "ferry" : "flight";
  return (
    <div
      id={`hop-${hop.segmentId}`}
      className={`my-2 scroll-mt-6 rounded-rv-md border border-l-[3px] border-rv-border border-l-rv-travel bg-rv-surface px-[13px] pb-3 pt-2.5 shadow-rv-sm ${
        flush ? "ml-0" : "ml-8"
      }`}
    >
      <div className="flex flex-wrap items-center gap-[9px] text-[13px] text-rv-ink-muted">
        <span className="inline-flex items-center gap-[5px] font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-rv-ink">
          <ModeIcon className="size-[13px]" />
          {hop.mode === "ferry" ? "Ferry" : "Fly"}
        </span>
        <b className="font-bold text-rv-ink">
          {hop.fromName} → {hop.toName}
        </b>
        {hop.meta && <span className="font-mono text-[11.5px] text-rv-ink-faded">{hop.meta}</span>}
        <span className="ml-auto inline-flex items-center gap-2">
          <HopModeSwitch value={hop.mode} onChange={(m) => actions.onMode(hop.segmentId, m)} />
        </span>
      </div>

      {hop.items.map((item, i) =>
        item.kind === "layover" ? (
          <div key={`lay-${i}`} className="pl-10 pt-1.5 font-mono text-[11px] text-rv-ink-faded">
            {item.label}
          </div>
        ) : (
          <HopBooking key={item.id} item={item} mode={hop.mode} onDelete={() => actions.onDelete(item.id)} />
        ),
      )}

      {formOpen ? (
        <HopForm
          key={hop.segmentId}
          hop={hop}
          trip={trip}
          kind={kind}
          onSave={actions.onSave}
          onCancel={() => actions.onOpenForm(null)}
        />
      ) : (
        <div className="mt-[9px]">
          <button
            type="button"
            onClick={() => actions.onOpenForm(hop.segmentId)}
            className="inline-flex cursor-pointer items-center gap-[5px] rounded-rv-md border border-dashed border-rv-border-hi bg-transparent px-2.5 py-[3px] text-[12px] font-bold text-rv-ink-muted"
          >
            <Plus className="size-[13px]" />
            {kind === "ferry" ? "Add ferry" : "Add flight"}
          </button>
        </div>
      )}
    </div>
  );
}

/** One flight or ferry: the Travel tile (Plane / Ship through `categoryMeta`'s
 * mode hint), its name as stored, and its local times with their zones. */
function HopBooking({
  item,
  mode,
  onDelete,
}: {
  item: RouteHopBooking;
  mode: TravelMode;
  onDelete: () => void;
}) {
  const sameZone = item.departAbbr !== null && item.departAbbr === item.arriveAbbr;
  return (
    <div className="mt-[9px] flex items-center gap-2.5 rounded-rv-card border border-rv-border-soft bg-rv-surface-alt px-[11px] py-[9px]">
      <CategoryTile meta={categoryMeta("transport", mode)} />
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-bold text-rv-ink">{item.name}</div>
        {item.departTime && item.arriveTime && (
          <div>
            {sameZone ? (
              <>
                <span className="font-mono text-[12px] text-rv-ink">
                  {item.departTime} → {item.arriveTime}
                </span>{" "}
                <span className="font-mono text-[10.5px] text-rv-ink-faded">
                  {item.arriveAbbr}
                  {item.duration ? ` · ${item.duration}` : ""}
                </span>
              </>
            ) : (
              <>
                <span className="font-mono text-[12px] text-rv-ink">{item.departTime}</span>{" "}
                <span className="font-mono text-[10.5px] text-rv-ink-faded">{item.departAbbr}</span>{" "}
                <span className="font-mono text-[12px] text-rv-ink">→ {item.arriveTime}</span>{" "}
                <span className="font-mono text-[10.5px] text-rv-ink-faded">
                  {item.arriveAbbr}
                  {item.duration ? ` · ${item.duration}` : ""}
                </span>
              </>
            )}
          </div>
        )}
      </div>
      {/* A mistyped flight re-times its hop, so it has to be removable
          (vet MED). Undo re-POSTs it onto the same hop. */}
      <RowMenu label={`Actions for ${item.name}`}>
        <DropdownMenuItem className={MENU_ITEM_WARN} onSelect={onDelete}>
          <Trash2 />
          Delete
          <MenuHint>undo</MenuHint>
        </DropdownMenuItem>
      </RowMenu>
    </div>
  );
}

const FORM_FIELD =
  "h-auto min-h-9 rounded-rv-md border-rv-border-hi bg-rv-navy-deep px-2.5 py-[7px] text-[13px] text-rv-ink md:text-[13px]";
const FORM_FIELD_MONO =
  "h-auto min-h-9 rounded-rv-md border-rv-border-hi bg-rv-navy-deep px-2.5 py-[7px] font-mono text-[12px] text-rv-ink md:text-[12px]";
const FORM_FIELD_RO =
  "h-auto min-h-9 rounded-rv-md border-rv-border-hi bg-rv-surface-alt px-2.5 py-[7px] text-[13px] text-rv-ink-muted md:text-[13px]";
const G3 = "grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(120px,1fr))]";
const SBTN =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-rv-md border border-rv-border-hi bg-transparent px-3.5 py-[7px] text-[12.5px] font-semibold text-rv-ink";

/**
 * Add flight / Add ferry (Q5 A · Q6 A · Q8 A). The times are the ones printed
 * on the ticket; each end's zone comes from its airport code (a ferry: from
 * its port stops). An amber chip is a question, not an error — pressing it
 * opens the zone list — and Save stays disabled until both ends have a zone.
 *
 * The date clash is judged HERE, before the POST, by core's
 * `hopBookingClash` — the same check the server repeats — and nothing saves
 * until one of its two fixes is picked.
 */
function HopForm({
  hop,
  trip,
  kind,
  onSave,
  onCancel,
}: {
  hop: RouteHop;
  trip: Trip;
  kind: "flight" | "ferry";
  onSave: (body: ReservationCreateInput, moveStop: boolean) => Promise<boolean>;
  onCancel: () => void;
}) {
  const stops = trip.legs.flatMap((l) => l.stops);
  const portOf = (id: string | null): Place | null => stops.find((s) => s.id === id)?.place ?? null;
  const ports = { from: portOf(hop.fromStopId), to: portOf(hop.toStopId) };
  const [draft, setDraft] = useState<HopBookingDraft>(() =>
    blankHopDraft(kind, { from: hop.fromName, to: hop.toName }),
  );
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<HopBookingDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const zones = hopDraftZones(draft, ports);
  const body = hopBookingInput(hop.segmentId, draft, zones);
  const clash = body ? hopBookingClash(trip, hop.segmentId, body) : null;
  const copy = clash ? hopClashCopy(clash, kind) : null;

  const save = async (move: boolean) => {
    if (!body || saving) return;
    setSaving(true);
    const ok = await onSave(body, move);
    if (!ok) setSaving(false);
  };

  const noun = kind === "ferry" ? "ferry" : "flight";
  return (
    <div className="mt-2.5 flex flex-col gap-2.5 rounded-rv-card border border-rv-border-hi bg-rv-surface p-3.5">
      <div className="font-mono text-[11.5px] text-rv-ink-faded">
        {kind === "ferry" ? "Add ferry" : "Add flight"}
      </div>

      {kind === "flight" ? (
        <div className={G3}>
          <Field label="Flight">
            <Input value={draft.label} onChange={(e) => set({ label: e.target.value })} placeholder="AA 1190" className={FORM_FIELD_MONO} />
          </Field>
          <Field label="From">
            <Input value={draft.from} onChange={(e) => set({ from: e.target.value, fromZone: null })} placeholder="LIR" className={FORM_FIELD_MONO} />
          </Field>
          <Field label="To">
            <Input value={draft.to} onChange={(e) => set({ to: e.target.value, toZone: null })} placeholder="DFW" className={FORM_FIELD_MONO} />
          </Field>
        </div>
      ) : (
        <>
          <Field label="Operator">
            <Input value={draft.label} onChange={(e) => set({ label: e.target.value })} className={FORM_FIELD} />
          </Field>
          <div className={G3}>
            <Field label="From port">
              <Input value={draft.from} readOnly className={FORM_FIELD_RO} />
            </Field>
            <Field label="To port">
              <Input value={draft.to} readOnly className={FORM_FIELD_RO} />
            </Field>
          </div>
        </>
      )}

      <div className={G3}>
        <Field label="Departs · local">
          <Input value={draft.departs} onChange={(e) => set({ departs: e.target.value })} placeholder="2027-01-24 19:30" className={FORM_FIELD_MONO} />
        </Field>
        <Field label="Arrives · local">
          <Input value={draft.arrives} onChange={(e) => set({ arrives: e.target.value })} placeholder="2027-01-24 23:55" className={FORM_FIELD_MONO} />
        </Field>
      </div>

      <ZoneRow draft={draft} zones={zones} kind={kind} onPick={set} />

      {kind === "flight" && body && !clash && <OkLine body={body} draft={draft} />}

      {clash && copy && (
        <div className="flex items-start gap-[9px] rounded-rv-card border border-rv-warning bg-rv-warning-soft px-3 py-2.5 text-[12.5px] text-rv-ink">
          <CircleAlert className="mt-0.5 size-4 flex-none text-rv-warning" />
          <div>
            <b className="text-rv-ink">{copy.headline}</b>
            <br />
            {copy.sub}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button type="button" disabled={saving} onClick={() => void save(true)} className={SBTN}>
                {copy.move}
              </button>
              <button type="button" onClick={() => setDraft((d) => fixHopDraftDates(d, clash))} className={SBTN}>
                {copy.keep}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-[9px]">
        <button
          type="button"
          onClick={() => void save(false)}
          disabled={!body || clash !== null || saving}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-rv-md border-none bg-rv-accent-deep px-3.5 py-[7px] text-[12.5px] font-bold text-rv-accent-ink disabled:cursor-default disabled:opacity-45"
        >
          {kind === "flight" && <Check className="size-[13px]" />}
          Save {noun}
        </button>
        <button type="button" onClick={onCancel} className={SBTN}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}

/** "America/Costa_Rica · CST" — the abbreviation in force at the typed time. */
function zoneLabel(zone: string, local: string): string {
  const at = localToInstant(local, zone) ?? new Date().toISOString();
  return `${zone} · ${instantToLocal(at, zone).abbr}`;
}

function ZoneRow({
  draft,
  zones,
  kind,
  onPick,
}: {
  draft: HopBookingDraft;
  zones: { from: ZoneChip; to: ZoneChip };
  kind: "flight" | "ferry";
  onPick: (patch: Partial<HopBookingDraft>) => void;
}) {
  // A flight's chip appears once its code is typed; a ferry's ports are fixed.
  const showFrom = kind === "ferry" || zones.from.code !== "";
  const showTo = kind === "flight" ? zones.to.code !== "" : zones.to.zone !== zones.from.zone;
  if (!showFrom && !showTo) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {showFrom && (
        <ZoneChipPicker chip={zones.from} local={draft.departs} onPick={(z) => onPick({ fromZone: z })} />
      )}
      {showFrom && showTo && <span className="font-mono text-[11.5px] text-rv-ink-faded">→</span>}
      {showTo && (
        <ZoneChipPicker chip={zones.to} local={draft.arrives} onPick={(z) => onPick({ toZone: z })} />
      )}
    </div>
  );
}

/**
 * One zone chip, and the zone list it opens. Green only when the TABLE
 * verified the code (the documented "verified" role); amber when it could
 * not — "XYZ? pick a zone"; neutral once the human picked one.
 */
function ZoneChipPicker({
  chip,
  local,
  onPick,
}: {
  chip: ZoneChip;
  local: string;
  onPick: (zone: string) => void;
}) {
  const tone = chip.verified
    ? "border-rv-green bg-rv-green-soft text-rv-green-ink"
    : chip.zone === null
      ? "border-rv-warning bg-rv-warning-soft text-rv-warning"
      : "border-rv-border-hi bg-rv-surface text-rv-ink-muted";
  return (
    <Select value={chip.zone ?? undefined} onValueChange={onPick}>
      <SelectTrigger
        aria-label={chip.zone ? `Zone: ${chip.zone}` : `Pick a zone for ${chip.code || "this end"}`}
        className={`h-auto w-auto cursor-pointer gap-1 rounded-rv-pill border px-2 py-px font-mono text-[10.5px] whitespace-nowrap ${tone} [&>svg:last-child]:hidden`}
      >
        {chip.verified && <Check className="size-[13px]" />}
        {chip.zone ? zoneLabel(chip.zone, local) : `${chip.code || "?"}? pick a zone`}
      </SelectTrigger>
      <SelectContent>
        {zoneChoices().map((z) => (
          <SelectItem key={z} value={z} className="font-mono text-[12px]">
            {z}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** "LIR 19:30 CST → DFW 23:55 CST · 4h 25m in the air" — the verified line. */
function OkLine({ body, draft }: { body: ReservationCreateInput; draft: HopBookingDraft }) {
  const dep = instantToLocal(body.startsAt!, body.startsTz!);
  const arr = instantToLocal(body.endsAt!, body.endsTz!);
  const mins = minutesBetween(body.startsAt!, body.endsAt!);
  return (
    <div className="flex items-center gap-2 rounded-rv-card border border-rv-green bg-rv-green-soft px-[11px] py-2 font-mono text-[12.5px] font-semibold text-rv-green-ink">
      <Check className="size-4 flex-none" />
      {`${draft.from.trim().toUpperCase()} ${dep.hhmm} ${dep.abbr} → ${draft.to.trim().toUpperCase()} ${arr.hhmm} ${arr.abbr} · ${formatDriveTime(mins)} in the air`}
    </div>
  );
}
