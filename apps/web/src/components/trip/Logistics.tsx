"use client";

import { useState } from "react";
import { Pencil, Plane, Plus, Ship, Trash2 } from "lucide-react";
import {
  hopBookingPatch,
  shuttleBookingInput,
  shuttleDraftFromBooking,
  shuttleZone,
  type Logistics as LogisticsModel,
  type LogisticsGroup,
  type Reservation,
  type ShuttleDraft,
  type Trip,
} from "@rv-trip/core";
import { CategoryTile, categoryMeta } from "@rv-trip/ui";
import { Input } from "@/components/ui/input";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { MENU_ITEM, MENU_ITEM_WARN, MenuHint, RowMenu } from "./row-menu";
import { Field, FORM_FIELD, FORM_FIELD_MONO, G3, HopForm, SBTN, type HopCardActions } from "./HopCard";

/**
 * The Logistics section (#155 · Q3 B) — after the last chapter, below "Add
 * chapter". One group per fly or ferry hop, booked or not, in segment order;
 * absent (no kicker either) on a trip with none. Each group carries the hop's
 * `#hop-<segmentId>` anchor and `scroll-mt-6`, so the hop card's chip — and a
 * fly/ferry day clicked on the Timeline — land here.
 *
 * The rows are the hop's bookings in local time, the layover between two
 * flights (or ferries), and its shuttles (Q4 A) — indented, after the arrival
 * outbound and before the departure home. A group with no flight shows one
 * ghost row with the hop's own clock. "+ Add flight" (or "+ Add ferry") opens
 * the shipped `HopForm`; "+ Add shuttle" its shuttle sibling. Tapping a row
 * edits it, as hop bookings always have.
 */
export function Logistics({
  model,
  trip,
  openHopId,
  actions,
}: {
  model: LogisticsModel;
  trip: Trip;
  /** The group whose Add flight / Add ferry form is open (the hop card's old
   * `formOpen`, still set by a fly/ferry day on the Timeline). */
  openHopId: string | null;
  actions: HopCardActions;
}) {
  return (
    <div id="logistics" className="mt-8 border-t border-rv-border pt-[18px]">
      <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-rv-ink-faded">Logistics</div>
      {model.groups.map((g) => (
        <Group key={g.segmentId} group={g} trip={trip} formOpen={openHopId === g.segmentId} actions={actions} />
      ))}
    </div>
  );
}

function Group({
  group: g,
  trip,
  formOpen,
  actions,
}: {
  group: LogisticsGroup;
  trip: Trip;
  formOpen: boolean;
  actions: HopCardActions;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [shuttleOpen, setShuttleOpen] = useState(false);
  const kind = g.mode === "ferry" ? "ferry" : "flight";
  const bookings = trip.segments.find((s) => s.id === g.segmentId)?.reservations ?? [];
  const editing = editingId ? (bookings.find((r) => r.id === editingId) ?? null) : null;
  const closeAll = () => {
    actions.onOpenForm(null);
    setShuttleOpen(false);
    setEditingId(null);
  };
  const edit = (id: string) => {
    closeAll();
    setEditingId(id);
  };

  return (
    <div
      id={`hop-${g.segmentId}`}
      className="mt-3 scroll-mt-6 rounded-rv-card border border-rv-border bg-rv-surface px-4 pb-3.5 pt-3 shadow-rv-sm"
    >
      <div className="flex flex-wrap items-baseline gap-2.5">
        {g.dayLabel && <span className="font-mono text-[12px] text-rv-ink-muted">{g.dayLabel}</span>}
        <b className="text-[14px] text-rv-ink">
          {g.fromName} → {g.toName}
        </b>
        {g.meta && <span className="ml-auto font-mono text-[11.5px] text-rv-ink-faded">{g.meta}</span>}
      </div>

      {g.items.map((item, i) =>
        item.kind === "layover" ? (
          <div key={`lay-${i}`} className="pl-10 pt-1.5 font-mono text-[11px] text-rv-ink-faded">
            {item.label}
          </div>
        ) : item.kind === "empty" ? (
          <div key="empty" className="flex items-center gap-2.5 pt-2.5 text-[14px]">
            <CategoryTile meta={{ ...categoryMeta("other"), Icon: g.mode === "ferry" ? Ship : Plane }} />
            <span className="min-w-0 flex-1 font-medium text-rv-ink-faded">{item.label}</span>
            <Clock {...item} />
          </div>
        ) : (
          <div key={item.id} className={`flex items-center gap-2.5 pt-2.5 text-[14px] ${item.aside ? "pl-5" : ""}`}>
            <CategoryTile meta={categoryMeta("transport", g.mode, item.transportKind)} />
            <button
              type="button"
              onClick={() => edit(item.id)}
              className="min-w-0 flex-1 cursor-pointer truncate border-none bg-transparent p-0 text-left font-semibold text-rv-ink"
            >
              {item.name}
            </button>
            <Clock {...item} />
            <RowMenu label={`Actions for ${item.name}`}>
              <DropdownMenuItem className={MENU_ITEM} onSelect={() => edit(item.id)}>
                <Pencil />
                Edit
              </DropdownMenuItem>
              {/* A mistyped flight re-times its hop, so it has to be removable
                  (vet MED). Undo re-POSTs it onto the same hop. */}
              <DropdownMenuItem className={MENU_ITEM_WARN} onSelect={() => actions.onDelete(item.id)}>
                <Trash2 />
                Delete
                <MenuHint>undo</MenuHint>
              </DropdownMenuItem>
            </RowMenu>
          </div>
        ),
      )}

      {editing ? (
        editing.transportKind === "shuttle" || editing.transportKind === "train" || editing.transportKind === "car" ? (
          <ShuttleForm
            key={`edit-${editing.id}`}
            group={g}
            trip={trip}
            editing={editing}
            actions={actions}
            onDone={() => setEditingId(null)}
          />
        ) : (
          <HopForm
            key={`edit-${editing.id}`}
            hop={g}
            trip={trip}
            kind={kind}
            editing={editing}
            onSave={actions.onSave}
            onEdit={async (patch) => {
              const ok = await actions.onEdit(editing.id, patch);
              if (ok) setEditingId(null);
              return ok;
            }}
            onDelete={() => {
              setEditingId(null);
              actions.onDelete(editing.id);
            }}
            onCancel={() => setEditingId(null)}
          />
        )
      ) : formOpen ? (
        <HopForm
          key={g.segmentId}
          hop={g}
          trip={trip}
          kind={kind}
          onSave={actions.onSave}
          onCancel={() => actions.onOpenForm(null)}
        />
      ) : shuttleOpen ? (
        <ShuttleForm key="shuttle" group={g} trip={trip} actions={actions} onDone={() => setShuttleOpen(false)} />
      ) : (
        <div className="flex flex-wrap gap-4 pl-10 pt-2.5 text-[13px] text-rv-ink">
          <button
            type="button"
            onClick={() => {
              closeAll();
              actions.onOpenForm(g.segmentId);
            }}
            className="inline-flex cursor-pointer items-center gap-[5px] border-none bg-transparent p-0 font-semibold text-rv-ink"
          >
            <Plus className="size-[13px]" />
            {kind === "ferry" ? "Add ferry" : "Add flight"}
          </button>
          <button
            type="button"
            onClick={() => {
              closeAll();
              setShuttleOpen(true);
            }}
            className="inline-flex cursor-pointer items-center gap-[5px] border-none bg-transparent p-0 font-semibold text-rv-ink"
          >
            <Plus className="size-[13px]" />
            Add shuttle
          </button>
        </div>
      )}
    </div>
  );
}

/** "06:05 MST → 08:10 PST" — a row's local clock, or nothing when untimed. */
function Clock({
  departTime,
  departAbbr,
  arriveTime,
  arriveAbbr,
}: {
  departTime: string | null;
  departAbbr: string | null;
  arriveTime: string | null;
  arriveAbbr: string | null;
}) {
  const end = (t: string | null, z: string | null) => (t ? `${t}${z ? ` ${z}` : ""}` : null);
  const text = [end(departTime, departAbbr), end(arriveTime, arriveAbbr)].filter(Boolean).join(" → ");
  if (!text) return null;
  return <span className="whitespace-nowrap font-mono text-[12px] text-rv-ink-muted">{text}</span>;
}

/**
 * "+ Add shuttle" (#155 · Q4 A) — the Add flight form's sibling: a name
 * (required) and two OPTIONAL local times, read in the hop's zone on the
 * shuttle's side. It writes `transportKind: "shuttle"`; a shuttle never
 * re-times its hop, so it has no date clash to judge.
 */
function ShuttleForm({
  group,
  trip,
  editing = null,
  actions,
  onDone,
}: {
  group: LogisticsGroup;
  trip: Trip;
  editing?: Reservation | null;
  actions: HopCardActions;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<ShuttleDraft>(() =>
    editing ? shuttleDraftFromBooking(editing) : { name: "", departs: "", arrives: "" },
  );
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<ShuttleDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const zone = shuttleZone(trip, group.segmentId);
  const body = shuttleBookingInput(group.segmentId, draft, zone);
  const noun = editing?.transportKind ?? "shuttle";

  const save = async () => {
    if (!body || saving) return;
    setSaving(true);
    const ok = editing
      ? await actions.onEdit(
          editing.id,
          hopBookingPatch(editing, {
            name: body.name,
            startsAt: body.startsAt,
            endsAt: body.endsAt,
            startsTz: body.startsTz,
            endsTz: body.endsTz,
          }),
        )
      : await actions.onSave(body, false);
    if (ok) onDone();
    else setSaving(false);
  };

  return (
    <div className="mt-2.5 flex flex-col gap-2.5 rounded-rv-card border border-rv-border-hi bg-rv-surface p-3.5">
      <div className="font-mono text-[11.5px] text-rv-ink-faded">{editing ? `Edit ${noun}` : "Add shuttle"}</div>
      <Field label="Name">
        <Input
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Airport shuttle"
          className={FORM_FIELD}
        />
      </Field>
      <div className={G3}>
        <Field label="Departs · local">
          <Input value={draft.departs} onChange={(e) => set({ departs: e.target.value })} className={FORM_FIELD_MONO} />
        </Field>
        <Field label="Arrives · local">
          <Input value={draft.arrives} onChange={(e) => set({ arrives: e.target.value })} className={FORM_FIELD_MONO} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-[9px]">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!body || saving}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-rv-md border-none bg-rv-accent-deep px-3.5 py-[7px] text-[12.5px] font-bold text-rv-accent-ink disabled:cursor-default disabled:opacity-45"
        >
          Save {noun}
        </button>
        <button type="button" onClick={onDone} className={SBTN}>
          Cancel
        </button>
        {editing && (
          <button
            type="button"
            onClick={() => {
              onDone();
              actions.onDelete(editing.id);
            }}
            className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-rv-md border border-rv-warning bg-transparent px-[11px] py-[5px] text-[11.5px] font-semibold text-rv-warning"
          >
            <Trash2 className="size-[13px]" />
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
