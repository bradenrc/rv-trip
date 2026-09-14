"use client";

import { useRouter } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import type { UserPrefs } from "@rv-trip/core";
import { SegmentedControl, type SegmentOption } from "@rv-trip/ui";
import { Account } from "@/components/nav/Account";
import { STYLE_PREF_KEY, STYLE_SEGMENTS } from "@/components/map/MapMount";
import { DEFAULT_STYLE_MODE, isStyleMode, type StyleMode } from "@/components/map/palette";
import { PrefSwitch } from "@/components/ui/pref-switch";
import { useBooleanPref, useStringPref } from "@/lib/pref";
import { useTheme, type Theme } from "@/lib/theme";
import { DEFAULT_UNITS, UNITS_PREF_KEY, isUnits, unitsFromPrefs, type Units } from "@/lib/units";

/**
 * Settings (issue #45 item 5 · issue #38) — one scrolling page, three cards of
 * labelled rows, identical in shape at 390px and at 1280px.
 *
 * NONE of these four preferences is new here. Theme, default map style and cost
 * tracking already have live consumers (the masthead toggle, every map, the
 * planner's rail); units is the one row that reaches into other screens, and it
 * reaches them as a SERVER prop, not from here. So this page is a second front
 * door onto the same four keys, never a second store — every control writes
 * through the same `lib/pref.ts` hooks, which mirror the write to `user_prefs`.
 *
 * The server row (`prefs`) is what the unresolved first render draws: the
 * `useStringPref` hooks answer `null` until localStorage is readable, and the
 * account's own answer is a better placeholder than the product default.
 *
 * Units is the one control that calls `router.refresh()`. The four screens that
 * honor it read it on the SERVER, so without an invalidation they would keep
 * rendering the previous unit from the router cache until a hard reload.
 */
export function SettingsForm({ prefs }: { prefs: UserPrefs | null }) {
  const router = useRouter();
  const [theme, setTheme] = useTheme();
  const [storedUnits, setUnits] = useStringPref(UNITS_PREF_KEY, isUnits, DEFAULT_UNITS);
  const [storedStyle, setStyle] = useStringPref(STYLE_PREF_KEY, isStyleMode, DEFAULT_STYLE_MODE);
  const [costs, setCosts] = useBooleanPref("rv-track-costs");

  const units = storedUnits ?? unitsFromPrefs(prefs);
  const style = storedStyle ?? styleFromPrefs(prefs);

  return (
    <>
      <div className="mb-2 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-rv-accent">
        Account
      </div>
      <h1 className="m-0 text-[40px] font-extrabold leading-none tracking-[-0.02em] text-rv-ink">
        Settings
      </h1>

      <div className="max-w-[680px]">
        <GroupKicker>Appearance</GroupKicker>
        <Card>
          <Row label="Theme" help="Dark is the default. The masthead toggle writes the same preference.">
            <SegmentedControl<Theme>
              value={theme}
              onChange={setTheme}
              options={[
                { value: "dark", label: "Dark", Icon: Moon },
                { value: "light", label: "Light", Icon: Sun },
              ]}
            />
          </Row>
          <Row label="Units" help="Rig dimensions and drive distances. Always stored metric.">
            <SegmentedControl<Units>
              value={units}
              onChange={(u) => {
                setUnits(u);
                router.refresh();
              }}
              options={UNIT_SEGMENTS}
            />
          </Row>
        </Card>

        <GroupKicker>Maps &amp; planning</GroupKicker>
        <Card>
          <Row
            label="Default map style"
            help="What every map opens with. Night is the product default."
          >
            <SegmentedControl<StyleMode> value={style} onChange={setStyle} options={STYLE_SEGMENTS} />
          </Row>
          <Row>
            <div className="flex items-center justify-between gap-3">
              <span>
                <span className="block text-[14px] font-bold text-rv-ink">Track costs</span>
                <span className="mt-0.5 block text-[12px] text-rv-ink-faded">
                  Show reservation costs and the per-leg rollup.
                </span>
              </span>
              <PrefSwitch checked={costs} onChange={setCosts} ariaLabel="Track costs" />
            </div>
          </Row>
        </Card>

        <GroupKicker>Account</GroupKicker>
        <Card>
          <Row>
            {/* `<Account/>` IS the row: Clerk's own menu when keys are set, the
                dashed dev-user stub when not. Nothing here restyles it. */}
            <div className="flex items-center justify-between gap-3">
              <Account />
            </div>
          </Row>
        </Card>
      </div>
    </>
  );
}

/** Label only — imperial and metric have no honest glyph between them, and the
 * design names none. `SegmentOption.Icon` is optional for exactly this. */
const UNIT_SEGMENTS: SegmentOption<Units>[] = [
  { value: "imperial", label: "Imperial" },
  { value: "metric", label: "Metric" },
];

function styleFromPrefs(prefs: UserPrefs | null): StyleMode {
  const stored = prefs?.mapStyle;
  return stored && isStyleMode(stored) ? stored : DEFAULT_STYLE_MODE;
}

function GroupKicker({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 mt-[18px] font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-rv-accent">
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-rv-card border border-rv-border bg-rv-surface px-3.5 py-1 shadow-rv-sm">
      {children}
    </div>
  );
}

/** One settings row: the 14px label and its 12px helper line, then the control
 * below. A row with no `label` lays its own two halves out instead. */
function Row({
  label,
  help,
  children,
}: {
  label?: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-rv-border-soft py-[13px] last:border-b-0">
      {label && <div className="text-[14px] font-bold text-rv-ink">{label}</div>}
      {help && <div className="mt-0.5 text-[12px] text-rv-ink-faded">{help}</div>}
      <div className={label ? "mt-[9px]" : undefined}>{children}</div>
    </div>
  );
}
