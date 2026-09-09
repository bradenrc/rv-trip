"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleDashed, LocateFixed } from "lucide-react";
import { toast } from "sonner";
import { LOCATE_MAX_ROWS, locateToastMessage } from "@rv-trip/core";
import type { ReservationType, SavedPlace, Trip } from "@rv-trip/core";
import {
  CategoryTile,
  FilterChip,
  Stars,
  categoryMeta,
  money,
  type CategoryLabel,
} from "@rv-trip/ui";
import { tripApi } from "@/lib/trip-api";
import { MapMount } from "./MapMount";
import {
  LAYER_LABEL,
  LAYER_ORDER,
  buildMapModel,
  categoryCounts,
  layerCounts,
  locateRowOf,
  type MapLayer,
  type MapPin,
  type PlacePin,
  type StopPin,
  type UnmappedRow,
} from "./pins";

/**
 * /map — everything on one map. Four layers, all on when you land, the canvas
 * docked to a 360px rail that carries what a pin can't say.
 *
 * The page fetches; this component owns the chip state, the selection and the
 * lazy map import (`next/dynamic({ ssr: false })` is illegal in a Server
 * Component on Next 16 — the same seam places/page.tsx → PlacesLibrary uses).
 */

/** One representative ReservationType per category, so a chip pulls its icon
 * and colour from categoryMeta rather than defining its own map. */
const CAT_CHIPS: { cat: CategoryLabel; type: ReservationType }[] = [
  { cat: "Stay", type: "campground" },
  { cat: "Eat", type: "dining" },
  { cat: "Do", type: "activity" },
  { cat: "Travel", type: "transport" },
];

type CatFilter = "All" | CategoryLabel;

export function MapOverview({ trips, places }: { trips: Trip[]; places: SavedPlace[] }) {
  const model = useMemo(() => buildMapModel(trips, places), [trips, places]);
  const [layers, setLayers] = useState<Set<MapLayer>>(() => new Set(LAYER_ORDER));
  const [cat, setCat] = useState<CatFilter>("All");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const router = useRouter();

  const lCounts = useMemo(() => layerCounts(model.pins, model.unmapped), [model]);
  const cCounts = useMemo(() => categoryCounts(places), [places]);

  const visible = useMemo(
    () =>
      model.pins.filter(
        (p) =>
          layers.has(p.layer) &&
          // The category filter scopes to saved places — the only pins that
          // carry a ReservationType. A Stop has no category (types.ts:79-90).
          (p.kind === "stop" || cat === "All" || p.category === cat),
      ),
    [model.pins, layers, cat],
  );
  const visibleArcs = useMemo(
    () => model.arcs.filter((a) => layers.has(a.layer)),
    [model.arcs, layers],
  );
  const unmappedVisible = useMemo(
    () => model.unmapped.filter((u) => layers.has(u.layer)),
    [model.unmapped, layers],
  );

  // A selection that a chip has just hidden falls back to the first visible pin,
  // so the rail is never pointing at something the map isn't drawing.
  const selected = visible.find((p) => p.id === pickedId) ?? visible[0] ?? null;
  const others = selected ? visible.filter((p) => p.id !== selected.id) : visible;

  /**
   * Locate (docs/design/41 §6) — one press, one bounded batch of at most
   * LOCATE_MAX_ROWS, the button disabled for the duration. Ids only leave the
   * browser; the route re-reads each row's name and region under the owner's
   * scope and geocodes server-side.
   *
   * The refresh path (the design left it unnamed): `router.refresh()`. /map is
   * a force-dynamic server component, and a written coordinate is not just a
   * pin — it is an ordinal, a rail row and possibly two drive arcs, all
   * recomputed by `buildMapModel` from props this island does not own. Patching
   * that locally would be a second, divergent copy of the model.
   */
  const locate = () => {
    const batch = unmappedVisible.slice(0, LOCATE_MAX_ROWS);
    if (batch.length === 0) return;
    setLocating(true);
    tripApi
      .locatePlaces(batch.map(locateRowOf))
      .then(({ located, results }) => {
        const found = new Set(results.map((r) => r.id));
        const stuck = batch.filter((u) => !found.has(u.id)).map((u) => u.name);
        toast.success(locateToastMessage(located, stuck));
        router.refresh();
      })
      .catch(() => toast.error("Locate didn't run — check your connection."))
      .finally(() => setLocating(false));
  };

  const toggleLayer = (l: MapLayer) => {
    setLayers((prev) => {
      const next = new Set(prev);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });
  };

  return (
    <>
      <div className="mb-[9px] flex flex-wrap gap-2">
        {LAYER_ORDER.map((l) => (
          <FilterChip
            key={l}
            label={LAYER_LABEL[l]}
            count={lCounts[l]}
            active={layers.has(l)}
            onClick={() => toggleLayer(l)}
          />
        ))}
      </div>

      <div className="mb-[22px] flex flex-wrap items-center gap-2">
        <FilterChip
          label="All"
          count={cCounts.All ?? 0}
          active={cat === "All"}
          onClick={() => setCat("All")}
        />
        {CAT_CHIPS.map((c) => (
          <FilterChip
            key={c.cat}
            label={c.cat}
            type={c.type}
            count={cCounts[c.cat] ?? 0}
            active={cat === c.cat}
            onClick={() => setCat(c.cat)}
          />
        ))}
        {unmappedVisible.length > 0 && (
          <>
            {/* A quiet fact, never a warning — and deliberately NOT a
                FilterChip: there is nothing here to press. The pressable thing
                is the Locate button BESIDE it (§6, Gap 2), which appears and
                disappears with this same count. */}
            <span className="inline-flex items-center rounded-rv-pill border border-dashed border-rv-border-hi bg-transparent px-[13px] py-1.5 font-mono text-[11px] text-rv-ink-faded">
              {unmappedVisible.length} unmapped
            </span>
            <LocateButton
              rows={unmappedVisible}
              running={locating}
              onClick={locate}
            />
          </>
        )}
      </div>

      <div className="overflow-hidden rounded-rv-card border border-rv-border-hi bg-rv-surface-alt">
        <div className="grid items-stretch max-[980px]:grid-cols-1" style={{ gridTemplateColumns: "1fr 360px" }}>
          <div className="h-[560px]">
            <MapMount
              pins={visible}
              arcs={visibleArcs}
              selectedId={selected?.id ?? null}
              onSelect={setPickedId}
              height="560px"
              unmappedCount={unmappedVisible.length}
            />
          </div>

          <div className="flex max-h-[560px] flex-col gap-2.5 overflow-y-auto border-l border-rv-border bg-rv-surface p-3.5">
            <RailHeader>Selected</RailHeader>
            {selected ? (
              <SelectedCard pin={selected} />
            ) : (
              <p className="m-0 font-mono text-[11px] text-rv-ink-faded">
                Every layer is switched off.
              </p>
            )}

            {others.length > 0 && (
              <>
                <RailHeader className="mt-[3px]">Also on this map · {others.length} more</RailHeader>
                {others.map((p) => (
                  <RailRow key={p.id} pin={p} onClick={() => setPickedId(p.id)} />
                ))}
              </>
            )}

            {unmappedVisible.map((u) => (
              <div
                key={u.id}
                className="flex items-center gap-2.5 rounded-rv-md border border-dashed border-rv-border-hi bg-rv-surface-alt px-2.5 py-2"
              >
                <CircleDashed className="size-[15px] flex-none text-rv-ink-subtle" />
                <span>
                  <span className="block text-[12.5px] font-semibold text-rv-ink-faded">{u.name}</span>
                  <span className="block font-mono text-[10px] text-rv-ink-faded">
                    No coordinates — not on the map
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="dark flex flex-wrap items-center gap-x-[18px] gap-y-2 border-t border-rv-border bg-rv-navy-deep px-3.5 py-[11px] text-[11.5px] text-rv-ink-faded">
          <LegendKey swatch={<i className="size-[13px] flex-none rounded-full border-2 border-rv-green bg-rv-green-soft" />}>
            Trip stop, in order
          </LegendKey>
          <LegendKey swatch={<i className="size-[13px] flex-none rounded-full border-2 border-rv-green bg-rv-navy-deep" />}>
            Been there
          </LegendKey>
          <LegendKey swatch={<i className="size-[13px] flex-none rounded-full border-2 border-dashed border-rv-warning bg-rv-navy-deep" />}>
            Floating stop
          </LegendKey>
          <LegendKey swatch={<i className="size-[13px] flex-none rounded-full bg-rv-accent" />}>Selected</LegendKey>
          <LegendKey swatch={<TeardropKey />}>Saved · want to go</LegendKey>
          <LegendKey swatch={<TeardropKey hollow />}>Saved · been there</LegendKey>
          <LegendKey swatch={<i className="inline-block w-6 flex-none border-t-2 border-dashed border-rv-accent" />}>
            Estimated drive — straight-line, not a road route
          </LegendKey>
        </div>
      </div>
    </>
  );
}

/**
 * The one pressable thing in the unmapped row. A button that looks like a
 * button — never a FilterChip, which reads as a filter — and it renders only
 * beside a count above zero, because its caller does.
 *
 * Its label says what the press costs: at most LOCATE_MAX_ROWS rows, so a
 * larger backlog reports the size of THIS batch, not of the backlog.
 */
function LocateButton({
  rows,
  running,
  onClick,
}: {
  rows: UnmappedRow[];
  running: boolean;
  onClick: () => void;
}) {
  const n = Math.min(rows.length, LOCATE_MAX_ROWS);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={running}
      className={`inline-flex items-center gap-1.5 rounded-rv-pill border px-[13px] py-1.5 font-mono text-[11px] ${
        running
          ? "cursor-default border-rv-border-hi bg-rv-surface text-rv-ink-faded"
          : "cursor-pointer border-rv-green bg-rv-green-soft font-bold text-rv-green"
      }`}
    >
      <LocateFixed className="size-3.5" />
      {running ? `Looking up ${n} ${n === 1 ? "place" : "places"}…` : "Locate"}
    </button>
  );
}

function RailHeader({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`font-mono text-[10px] uppercase tracking-[0.12em] text-rv-ink-faded ${className}`}>
      {children}
    </div>
  );
}

function LegendKey({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-[7px]">
      {swatch}
      {children}
    </span>
  );
}

/** Colours are classNames, not inline `var(--color-rv-*)`: `@theme` maps the
 * rv-* names on `:root` only, so an inline read resolves the DOCUMENT half and
 * would keep painting light-half green inside this `.dark` legend bar. Only the
 * teardrop geometry — which has no half — stays inline. */
function TeardropKey({ hollow = false }: { hollow?: boolean }) {
  return (
    <i
      className={`size-[13px] flex-none border-2 ${
        hollow ? "border-rv-green bg-rv-navy-deep" : "border-transparent bg-rv-green"
      }`}
      style={{
        borderRadius: "50% 50% 50% 0",
        transform: "rotate(-45deg)",
      }}
    />
  );
}

/** The selected pin, in full. Not `ReservationLineItem` (RouteItems.tsx:7) — the
 * rail's rows carry a mono meta line that component has no room for, so these
 * are token-styled layout glue rather than DS reuse. */
function SelectedCard({ pin }: { pin: MapPin }) {
  return (
    <div className="rounded-rv-card border border-rv-accent-deep bg-rv-surface px-3.5 py-[13px] shadow-rv-lg">
      {pin.kind === "stop" ? <SelectedStop pin={pin} /> : <SelectedPlace pin={pin} />}
    </div>
  );
}

function SelectedStop({ pin }: { pin: StopPin }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-[9px]">
        <span className="text-[15.5px] font-bold tracking-[-0.01em] text-rv-ink">{pin.name}</span>
        <span className="font-mono text-[11.5px] text-rv-ink-faded">
          {pin.dates ? `${pin.dates} · ${pin.nights} nights` : "Floating — no dates yet"}
        </span>
        {pin.rating != null && <Stars value={pin.rating} />}
      </div>
      <div className="mt-[3px] font-mono text-[11.5px] text-rv-ink-faded">
        {pin.tripTitle} · {pin.legTitle}
        {pin.ordinal != null ? ` · stop ${pin.ordinal} of ${pin.scheduledTotal}` : " · floating"}
      </div>
      <div className="font-mono text-[11.5px] text-rv-ink-faded">{formatCoords(pin)}</div>
      {pin.notes && (
        <p className="m-0 mt-[7px] text-[12.5px] text-rv-ink-muted">&ldquo;{pin.notes}&rdquo;</p>
      )}
      {pin.reservations.map((r) => (
        <div key={r.id} className="mt-[9px] flex items-center gap-[9px]">
          <CategoryTile type={r.type} />
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] font-semibold text-rv-ink">{r.name}</span>
            <span className="block font-mono text-[10px] uppercase tracking-[0.06em] text-rv-ink-faded">
              {r.meta}
            </span>
          </span>
          {r.cost != null && (
            <span className="ml-auto font-mono text-[12.5px] font-semibold text-rv-accent">
              {money(r.cost)}
            </span>
          )}
        </div>
      ))}
    </>
  );
}

function SelectedPlace({ pin }: { pin: PlacePin }) {
  const cm = categoryMeta(pin.type);
  return (
    <>
      <div
        className="font-mono text-[10px] font-bold uppercase tracking-[0.09em]"
        style={{ color: cm.color }}
      >
        {cm.cat} · {pin.type}
      </div>
      <div className="mt-[5px] flex flex-wrap items-center gap-[9px]">
        <span className="text-[15.5px] font-bold tracking-[-0.01em] text-rv-ink">{pin.name}</span>
        {pin.rating != null && <Stars value={pin.rating} />}
      </div>
      <div className="font-mono text-[11.5px] text-rv-ink-faded">
        {[pin.region, pin.source ? `from ${pin.source}` : null, pin.tripName].filter(Boolean).join(" · ")}
      </div>
      <div className="font-mono text-[11.5px] text-rv-ink-faded">{formatCoords(pin)}</div>
      {pin.note && (
        <p className="m-0 mt-[7px] text-[12.5px] text-rv-ink-muted">&ldquo;{pin.note}&rdquo;</p>
      )}
    </>
  );
}

function RailRow({ pin, onClick }: { pin: MapPin; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-[9px] rounded-rv-md border border-rv-border-soft bg-rv-surface-alt px-2.5 py-2 text-left"
    >
      <RailGlyph pin={pin} />
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-semibold text-rv-ink">{pin.name}</span>
        <span className="block font-mono text-[10px] text-rv-ink-faded">{railMeta(pin)}</span>
      </span>
    </button>
  );
}

function RailGlyph({ pin }: { pin: MapPin }) {
  if (pin.kind === "place") {
    const color = categoryMeta(pin.type).color;
    const been = pin.status === "been";
    return (
      <i
        className="size-[15px] flex-none border-2"
        style={{
          borderRadius: "50% 50% 50% 0",
          transform: "rotate(-45deg)",
          margin: "2px 3px 0 3px",
          background: been ? "var(--color-rv-navy-deep)" : color,
          borderColor: been ? color : "transparent",
        }}
      />
    );
  }
  const base =
    "flex size-[22px] flex-none items-center justify-center rounded-rv-pill border-2 font-mono text-[10.5px] font-bold";
  if (pin.floating) {
    return (
      <span className={`${base} border-dashed border-rv-warning bg-rv-navy-deep text-[11px] text-rv-warning`}>◇</span>
    );
  }
  return (
    <span
      className={
        pin.layer === "been"
          ? `${base} border-rv-green bg-rv-navy-deep text-rv-green`
          : `${base} border-rv-green bg-rv-green-soft text-rv-green-ink`
      }
    >
      {pin.ordinal}
    </span>
  );
}

function railMeta(pin: MapPin): string {
  if (pin.kind === "stop") {
    return `${LAYER_LABEL[pin.layer]} · ${pin.dates ?? "floating"}`;
  }
  const shelf = pin.status === "want" ? "want" : "been";
  return ["Saved", shelf, pin.region].filter(Boolean).join(" · ");
}

/** Coordinates as the rail prints them — a typographic minus, not a hyphen. */
function formatCoords(pin: { lat: number; lng: number }): string {
  const fmt = (n: number) => n.toFixed(4).replace("-", "−");
  return `${fmt(pin.lat)}, ${fmt(pin.lng)}`;
}
