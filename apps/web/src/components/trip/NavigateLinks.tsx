import { navigateLinks, navigationCaption, type RouteDrive } from "@rv-trip/core";

/**
 * #180 · q1 A / q2 A (docs/design/181 frames 2 and 5) — Navigate on a drive.
 *
 * Every drive carries three plain links to the arriving destination: Google,
 * Apple and Waze, destination only (core's `navigateLinks`). They make no RV
 * claim at all. A rig-on trip also keeps a labelled "RV route" line under them:
 * the corridor-checked Google link (`drive.navUrl`, ✓ only when the check
 * passed), HERE WeGo (`drive.navWegoUrl`), and the shipped caption — both
 * strings and the tone come from core's `navigationCaption`.
 *
 * Retires the split `NavigateButton`: its sky pill became the three neutral
 * pills (min-h-8 kept for a tap at a fuel stop), its two menu rows became the
 * RV route line.
 */

/** The neutral pill all five links wear. Fill and ink on one line, because the
 * nightfall-tokens sweeps read them per call site. */
const PILL =
  "inline-flex min-h-8 items-center gap-1 whitespace-nowrap rounded-rv-pill bg-rv-navy-soft px-3 font-sans text-[12px] font-bold text-rv-ink no-underline";

/** "→ Newport, OR" and the Google · Apple · Waze pills, inline in the drive row. */
export function NavigateLinks({
  drive,
  toName,
  className = "",
}: {
  drive: RouteDrive;
  /** The arriving destination's name. */
  toName: string;
  className?: string;
}) {
  const links = navigateLinks(drive.navTo);
  return (
    <span className={`inline-flex flex-wrap items-center gap-[5px] ${className}`}>
      <span className="mr-1 font-mono text-[11px] text-rv-ink-faded">→ {toName}</span>
      <a href={links.google} target="_blank" rel="noreferrer" className={PILL}>
        Google
      </a>
      <a href={links.apple} target="_blank" rel="noreferrer" className={PILL}>
        Apple
      </a>
      <a href={links.waze} target="_blank" rel="noreferrer" className={PILL}>
        Waze
      </a>
    </span>
  );
}

/**
 * The rig-on "RV route · from Astoria" line. Nothing at all when the trip has
 * no rig: rig off, the three pills are all of Navigate.
 */
export function RvRouteLine({
  drive,
  rigOn,
  fromName,
}: {
  drive: RouteDrive;
  rigOn: boolean;
  /** The leaving destination's name — the label keeps the part before the
   * first comma ("Astoria, OR" → "Astoria"). */
  fromName: string;
}) {
  if (!rigOn) return null;
  const caption = navigationCaption(drive);
  const checked = drive.navVerdict === "checked";
  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-dashed border-rv-border-hi pt-2">
      <div className="flex flex-wrap items-center gap-[5px]">
        <span className="mr-auto font-mono text-[10.5px] uppercase tracking-[0.06em] text-rv-ink-faded">
          RV route · from {fromName.split(",")[0]}
        </span>
        <a href={drive.navUrl} target="_blank" rel="noreferrer" className={PILL}>
          Google
          {checked && <span className="text-rv-green">✓</span>}
        </a>
        <a href={drive.navWegoUrl} target="_blank" rel="noreferrer" className={PILL}>
          HERE WeGo
        </a>
      </div>
      <span
        className={`font-sans text-[11.5px] ${
          caption.tone === "checked" ? "text-rv-green" : "text-rv-warning"
        }`}
      >
        {caption.text}
      </span>
    </div>
  );
}
