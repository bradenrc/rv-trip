"use client";

import { useState } from "react";
import { Circle } from "lucide-react";
import { toast } from "sonner";
import {
  RIG_PRESETS,
  feetInchesToMeters,
  metersToFeetInches,
  metersToVendorCm,
  kilogramsToVendorKg,
  poundsToKilograms,
  kilogramsToPounds,
  type RigProfile,
  type RigType,
  type Units,
} from "@rv-trip/core";
import { FieldLabel, SegmentedControl } from "@rv-trip/ui";
import { PageShell } from "@/components/nav/PageShell";
import { Input } from "@/components/ui/input";
import { tripApi } from "@/lib/trip-api";

/**
 * /rig — six numbers you type once and rely on for years, where wrong-by-a-typo
 * is a bridge strike.
 *
 * A class preset fills all six with a plausible starting point in one tap, then
 * every field stays freely editable: the preset is a head start, never a lock,
 * and the class itself is never stored (G5 — RigProfile.type has two values,
 * the class picker has four). Imperial in, metric stored, centimetres out.
 *
 * `units` (issue #45 item 5) changes only what you TYPE. In imperial the fields
 * are feet + inches and pounds and the form converts on the way in, exactly as
 * it shipped. In metric they are metres and kilograms — and metric converts
 * NOTHING, because `rig.ts` already stores metres at millimetre precision and
 * kilograms outright. The vendor boundary (whole centimetres / kilograms,
 * always UP) is unchanged in both: it is a safety rule, not a display one.
 */

/** One dimension as typed. `ft`/`inch` are the imperial pair; `m` is the metric
 * single field. Only one side is ever filled — `units` says which. */
interface Dim {
  ft: string;
  inch: string;
  m: string;
}

const BLANK: Dim = { ft: "", inch: "", m: "" };

function toDim(meters: number | undefined, units: Units): Dim {
  if (meters == null) return BLANK;
  // Metric shows the STORED number, untrimmed: 11'6" is exactly 3.5052 m, and
  // rounding it to 3.51 for display would drift the value on the next save.
  if (units === "metric") return { ...BLANK, m: String(meters) };
  const { feet, inches } = metersToFeetInches(meters);
  return { ft: String(feet), inch: String(inches), m: "" };
}

function dimMeters(d: Dim, units: Units): number | null {
  if (units === "metric") {
    if (d.m === "") return null;
    const m = Number(d.m);
    return Number.isFinite(m) && m > 0 ? m : null;
  }
  if (d.ft === "" && d.inch === "") return null;
  const ft = Number(d.ft || 0);
  const inch = Number(d.inch || 0);
  if (!Number.isFinite(ft) || !Number.isFinite(inch) || ft < 0 || inch < 0) return null;
  const meters = feetInchesToMeters(ft, inch);
  return meters > 0 ? meters : null;
}

/** The weight field as typed — pounds in imperial, kilograms in metric — as the
 * kilograms the schema stores. Metric converts nothing. */
function weightKilograms(value: string, units: Units): number | null {
  if (value === "") return null;
  const n = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return units === "metric" ? n : poundsToKilograms(n);
}

/** The inverse, for a stored rig and for a preset. */
function weightField(kg: number, units: Units): string {
  return units === "metric" ? String(kg) : String(kilogramsToPounds(kg));
}

export function RigForm({ rig, units }: { rig: RigProfile | null; units: Units }) {
  const metric = units === "metric";
  const [name, setName] = useState(rig?.name ?? "");
  const [type, setType] = useState<RigType>(rig?.type ?? "motorhome");
  const [height, setHeight] = useState<Dim>(toDim(rig?.heightMeters, units));
  const [length, setLength] = useState<Dim>(toDim(rig?.lengthMeters, units));
  const [width, setWidth] = useState<Dim>(toDim(rig?.widthMeters, units));
  const [weight, setWeight] = useState(rig ? weightField(rig.grossWeightKg, units) : "");
  const [propane, setPropane] = useState(rig?.propaneOnBoard ?? false);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const applyPreset = (id: string) => {
    setPresetId(id);
    const values = RIG_PRESETS.find((p) => p.id === id)?.values;
    if (!values) return; // "Something else" fills nothing and decides no type.
    setType(values.type);
    setHeight(toDim(values.heightMeters, units));
    setLength(toDim(values.lengthMeters, units));
    setWidth(toDim(values.widthMeters, units));
    setWeight(weightField(values.grossWeightKg, units));
    setPropane(values.propaneOnBoard);
  };

  const heightMeters = dimMeters(height, units);
  const lengthMeters = dimMeters(length, units);
  const widthMeters = dimMeters(width, units);
  const grossWeightKg = weightKilograms(weight, units);
  const complete =
    name.trim() !== "" &&
    heightMeters !== null &&
    lengthMeters !== null &&
    widthMeters !== null &&
    grossWeightKg !== null;

  const save = async () => {
    if (!complete || saving) return;
    setSaving(true);
    try {
      await tripApi.saveRig({
        name: name.trim(),
        type,
        heightMeters: heightMeters!,
        widthMeters: widthMeters!,
        lengthMeters: lengthMeters!,
        grossWeightKg: grossWeightKg!,
        propaneOnBoard: propane,
      });
      toast.success("Rig saved.");
    } catch {
      toast.error("That didn't save — check your connection.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell>
      <div className="max-w-[760px]">
        <div className="mb-1.5 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-rv-accent">
          Profile
        </div>
        <h1 className="m-0 mb-1.5 text-[34px] font-extrabold leading-none tracking-[-0.02em] text-rv-ink">
          Your rig
        </h1>
        <p className="m-0 mb-[22px] max-w-[70ch] text-[14px] text-rv-ink-muted">
          One rig, set once. Its height, weight and length shape every drive on every trip — and
          propane on board keeps you out of hazmat tunnels.
        </p>

        <div className="rounded-rv-card border border-rv-border bg-rv-surface px-5 py-[18px] shadow-rv-sm">
          <div>
            <FieldLabel>Rig name</FieldLabel>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sunseeker 2450"
              className="mt-1.5 h-auto min-h-9 rounded-rv-md border-rv-border-hi bg-rv-surface-alt px-[11px] py-2 text-[13px] text-rv-ink md:text-[13px]"
            />
          </div>

          <div className="mt-[18px]">
            <FieldLabel>Start from a class — then adjust anything</FieldLabel>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {RIG_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset.id)}
                  aria-pressed={presetId === preset.id}
                  className={`min-w-[132px] cursor-pointer rounded-rv-md border bg-rv-surface-alt px-3 py-[9px] text-left ${
                    presetId === preset.id
                      ? "border-rv-accent bg-rv-accent-soft"
                      : "border-rv-border-hi"
                  }`}
                >
                  <div className="text-[13px] font-bold text-rv-ink">{preset.label}</div>
                  <div className="mt-[3px] font-mono text-[10px] text-rv-ink-faded">
                    {preset.description}
                  </div>
                </button>
              ))}
            </div>
            <Hint>
              Starting points, not measurements — check yours against the plate on the rig. Nothing
              here is saved until you press Save.
            </Hint>
          </div>

          <div className="mt-[18px]">
            <FieldLabel>Type — set by the class, still yours to change</FieldLabel>
            <div className="mt-1.5">
              <SegmentedControl<RigType>
                value={type}
                onChange={setType}
                options={[
                  { value: "motorhome", label: "Motorhome", Icon: Circle },
                  { value: "trailer", label: "Trailer + tow", Icon: Circle },
                ]}
              />
            </div>
          </div>

          <div className="mt-[14px] grid grid-cols-1 gap-[14px] sm:grid-cols-2">
            <DimField
              label="Height"
              value={height}
              onChange={setHeight}
              meters={heightMeters}
              units={units}
            />
            <DimField
              label="Length"
              value={length}
              onChange={setLength}
              meters={lengthMeters}
              units={units}
            />
            <DimField
              label="Width"
              value={width}
              onChange={setWidth}
              meters={widthMeters}
              units={units}
            />
            <div>
              <FieldLabel>Gross weight</FieldLabel>
              <div className="mt-1.5">
                <NumberBox>
                  <UnitInput
                    value={weight}
                    onChange={setWeight}
                    width="w-16"
                    label={metric ? "Gross weight in kilograms" : "Gross weight in pounds"}
                  />
                  <span className="text-rv-ink-faded">{metric ? "kg" : "lb"}</span>
                </NumberBox>
              </div>
              {grossWeightKg !== null && (
                <Hint>
                  {!metric && (
                    <>
                      = {grossWeightKg.toLocaleString("en-US", { minimumFractionDigits: 2 })} kg
                      stored ·{" "}
                    </>
                  )}
                  sent as {kilogramsToVendorKg(grossWeightKg).toLocaleString("en-US")} kg
                </Hint>
              )}
            </div>
          </div>

          <div className="mt-[18px]">
            <FieldLabel>Propane on board</FieldLabel>
            <div className="mt-1.5">
              <SegmentedControl<"yes" | "no">
                value={propane ? "yes" : "no"}
                onChange={(v) => setPropane(v === "yes")}
                options={[
                  { value: "yes", label: "Yes", Icon: Circle },
                  { value: "no", label: "No", Icon: Circle },
                ]}
              />
            </div>
            <Hint>Hazmat-restricted tunnels are routed around when Yes.</Hint>
          </div>

          <div className="mt-[18px] flex flex-wrap items-center gap-3 border-t border-rv-border-soft pt-3.5">
            <button
              type="button"
              onClick={save}
              disabled={!complete || saving}
              className="cursor-pointer rounded-rv-md border-none bg-rv-accent-deep px-4 py-2 text-[13px] font-bold text-rv-accent-ink shadow-rv-sm disabled:cursor-default disabled:opacity-45"
            >
              {saving ? "Saving…" : "Save rig"}
            </button>
            <span className="text-[12.5px] text-rv-ink-faded">
              Saving re-routes every drive on every trip.
            </span>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

function DimField({
  label,
  value,
  onChange,
  meters,
  units,
}: {
  label: string;
  value: Dim;
  onChange: (d: Dim) => void;
  meters: number | null;
  units: Units;
}) {
  const metric = units === "metric";
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="mt-1.5">
        <NumberBox>
          {metric ? (
            <>
              <UnitInput
                value={value.m}
                onChange={(m) => onChange({ ...value, m })}
                width="w-16"
                label={`${label} in metres`}
              />
              <span className="text-rv-ink-faded">m</span>
            </>
          ) : (
            <>
              <UnitInput
                value={value.ft}
                onChange={(ft) => onChange({ ...value, ft })}
                width="w-8"
                label={`${label} in feet`}
              />
              <span className="text-rv-ink-faded">ft</span>
              <UnitInput
                value={value.inch}
                onChange={(inch) => onChange({ ...value, inch })}
                width="w-8"
                label={`${label} in inches`}
              />
              <span className="text-rv-ink-faded">in</span>
            </>
          )}
        </NumberBox>
      </div>
      {meters !== null && (
        <Hint>
          {/* Metric converts nothing — what you typed IS what is stored — so the
              hint carries only the vendor boundary, which is a safety rule and
              not a display one. */}
          {!metric && <>= {meters.toFixed(4)} m stored · </>}
          sent as {metersToVendorCm(meters)} cm
        </Hint>
      )}
    </div>
  );
}

/** The `.fauxinput.mono` box: one field that reads "11 ft 6 in". */
function NumberBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-9 items-center gap-1.5 rounded-rv-md border border-rv-border-hi bg-rv-surface-alt px-[11px] py-2 font-mono text-[13px] text-rv-ink focus-within:border-rv-green">
      {children}
    </div>
  );
}

function UnitInput({
  value,
  onChange,
  width,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  width: string;
  label: string;
}) {
  return (
    <input
      inputMode="decimal"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
      className={`${width} border-none bg-transparent p-0 text-right font-mono text-[13px] text-rv-ink outline-none`}
    />
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div className="mt-[5px] font-mono text-[10.5px] text-rv-ink-faded">{children}</div>;
}
