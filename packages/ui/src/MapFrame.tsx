import { Map as MapIcon, TriangleAlert, CircleDashed } from "lucide-react";

/**
 * The three frames where no map renders. Vendor GL code never enters the design
 * system, so the DS owns what the reader sees while the ~200KB chunk loads, when
 * the publishable token is missing at runtime, and when every visible point is
 * coordless. Each frame holds the exact footprint the real map would, so nothing
 * reflows when the map arrives.
 */
export type MapFrameState = "loading" | "unavailable" | "empty";

export function MapFrame({
  state,
  count,
  height,
}: {
  state: MapFrameState;
  /** How many coordless points the "empty" frame is standing in for. */
  count?: number;
  /** CSS length for the frame. Omit to fill the cell it sits in. */
  height?: string;
}) {
  const sizing = height ? undefined : "h-full min-h-[150px]";
  const style = height ? { height } : undefined;

  if (state === "unavailable") {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1.5 rounded-rv-card border border-rv-warning bg-rv-warning-soft px-[18px] text-center ${sizing ?? ""}`}
        style={style}
      >
        <TriangleAlert className="size-6 text-rv-warning" />
        <div className="text-[14px] font-bold text-rv-warning">Map unavailable</div>
        <p className="m-0 max-w-[36ch] text-[12.5px] text-rv-warning">
          The map token isn&rsquo;t configured for this environment. Everything else on this page
          still works.
        </p>
      </div>
    );
  }

  if (state === "empty") {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1.5 rounded-rv-card border border-dashed border-rv-border-hi bg-rv-surface-alt px-[18px] text-center ${sizing ?? ""}`}
        style={style}
      >
        <CircleDashed className="size-6 text-rv-ink-subtle" />
        <div className="text-[14px] font-bold text-rv-ink">Nothing to map yet</div>
        <p className="m-0 max-w-[36ch] text-[12.5px] text-rv-ink-muted">
          {count == null
            ? "None of these places has coordinates."
            : `None of these ${count} places has coordinates.`}{" "}
          They&rsquo;re all still in the list.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`relative flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-rv-card border border-rv-border bg-gradient-to-br from-rv-navy-soft to-rv-surface-alt text-center ${sizing ?? ""}`}
      style={style}
    >
      <div
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "linear-gradient(var(--color-rv-border) 1px, transparent 0), linear-gradient(90deg, var(--color-rv-border) 1px, transparent 0)",
          backgroundSize: "32px 32px",
        }}
      />
      <div className="relative">
        <MapIcon className="mx-auto size-[26px] text-rv-green" />
        <div className="mt-1 text-[14px] font-bold text-rv-ink">Map view</div>
        <div className="mt-0.5 font-mono text-[11px] text-rv-ink-faded">Loading tiles&hellip;</div>
      </div>
    </div>
  );
}
