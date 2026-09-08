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
} from "@rv-trip/core";
import { FieldLabel, SegmentedControl } from "@rv-trip/ui";
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
 */

interface Dim {
  ft: string;
  inch: string;
}

const BLANK: Dim = { ft: "", inch: "" };

function toDim(meters: number | undefined): Dim {
  if (meters == null) return BLANK;
  const { feet, inches } = metersToFeetInches(meters);
  return { ft: String(feet), inch: String(inches) };
}

function dimMeters(d: Dim): number | null {
  if (d.ft === "" && d.inch === "") return null;
  const ft = Number(d.ft || 0);
  const inch = Number(d.inch || 0);
  if (!Number.isFinite(ft) || !Number.isFinite(inch) || ft < 0 || inch < 0) return null;
  const meters = feetInchesToMeters(ft, inch);
  return meters > 0 ? meters : null;
}

function poundsValue(lb: string): number | null {
  if (lb === "") return null;
  const n = Number(lb.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function RigForm({ rig }: { rig: RigProfile | null }) {
  const [name, setName] = useState(rig?.name ?? "");
  const [type, setType] = useState<RigType>(rig?.type ?? "motorhome");
  const [height, setHeight] = useState<Dim>(toDim(rig?.heightMeters));
  const [length, setLength] = useState<Dim>(toDim(rig?.lengthMeters));
  const [width, setWidth] = useState<Dim>(toDim(rig?.widthMeters));
  const [pounds, setPounds] = useState(
    rig ? String(kilogramsToPounds(rig.grossWeightKg)) : "",
  );
  const [propane, setPropane] = useState(rig?.propaneOnBoard ?? false);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const applyPreset = (id: string) => {
    setPresetId(id);
    const values = RIG_PRESETS.find((p) => p.id === id)?.values;
    if (!values) return; // "Something else" fills nothing and decides no type.
    setType(values.type);
    setHeight(toDim(values.heightMeters));
    setLength(toDim(values.lengthMeters));
    setWidth(toDim(values.widthMeters));
    setPounds(String(kilogramsToPounds(values.grossWeightKg)));
    setPropane(values.propaneOnBoard);
  };

  const heightMeters = dimMeters(height);
  const lengthMeters = dimMeters(length);
  const widthMeters = dimMeters(width);
  const lb = poundsValue(pounds);
  const complete =
    name.trim() !== "" &&
    heightMeters !== null &&
    lengthMeters !== null &&
    widthMeters !== null &&
    lb !== null;

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
        grossWeightKg: poundsToKilograms(lb!),
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
    <main className="mx-auto w-full max-w-[1120px] px-7 pb-[72px] pt-9">
      <div className="max-w-[760px]">
        <div className="mb-1.5 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-rv-ember">
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
                      ? "border-rv-ember bg-rv-ember-soft"
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
            <DimField label="Height" value={height} onChange={setHeight} meters={heightMeters} />
            <DimField label="Length" value={length} onChange={setLength} meters={lengthMeters} />
            <DimField label="Width" value={width} onChange={setWidth} meters={widthMeters} />
            <div>
              <FieldLabel>Gross weight</FieldLabel>
              <div className="mt-1.5">
                <NumberBox>
                  <UnitInput
                    value={pounds}
                    onChange={setPounds}
                    width="w-16"
                    label="Gross weight in pounds"
                  />
                  <span className="text-rv-ink-faded">lb</span>
                </NumberBox>
              </div>
              {lb !== null && (
                <Hint>
                  = {poundsToKilograms(lb).toLocaleString("en-US", { minimumFractionDigits: 2 })} kg
                  stored · sent as {kilogramsToVendorKg(poundsToKilograms(lb)).toLocaleString("en-US")} kg
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
              className="cursor-pointer rounded-rv-md border-none bg-rv-ember px-4 py-2 text-[13px] font-bold text-rv-navy shadow-rv-sm disabled:cursor-default disabled:opacity-45"
            >
              {saving ? "Saving…" : "Save rig"}
            </button>
            <span className="text-[12.5px] text-rv-ink-faded">
              Saving re-routes every drive on every trip.
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}

function DimField({
  label,
  value,
  onChange,
  meters,
}: {
  label: string;
  value: Dim;
  onChange: (d: Dim) => void;
  meters: number | null;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="mt-1.5">
        <NumberBox>
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
        </NumberBox>
      </div>
      {meters !== null && (
        <Hint>
          = {meters.toFixed(4)} m stored · sent as {metersToVendorCm(meters)} cm
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
