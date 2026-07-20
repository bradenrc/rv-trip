import type { IdeaStatus } from "@rv-trip/core";
import { statusMeta } from "./category";

/**
 * A compact status indicator (icon + label) for an idea, used inline in list
 * rows where a full pill would be too heavy.
 */
export function StatusMarker({ status }: { status: IdeaStatus }) {
  const sm = statusMeta(status);
  return (
    <span
      className="inline-flex flex-none items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.06em]"
      style={{ color: sm.color }}
    >
      <sm.Icon className="size-3.5" />
      {status}
    </span>
  );
}
