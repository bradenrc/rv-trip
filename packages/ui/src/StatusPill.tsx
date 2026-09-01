import type { IdeaStatus } from "@rv-trip/core";

const PILL: Record<IdeaStatus, string> = {
  idea: "bg-rv-surface-alt text-rv-ink-faded border border-rv-border",
  planned: "bg-rv-navy-soft text-rv-ink border border-rv-navy-soft",
  done: "bg-rv-green-soft text-rv-green-ink border border-rv-green",
};

/**
 * An idea's status as a pill (idea → planned → done). When `onClick` is given
 * it becomes a button that the caller cycles to the next status.
 */
export function StatusPill({
  status,
  onClick,
}: {
  status: IdeaStatus;
  onClick?: () => void;
}) {
  const cls = `rounded-rv-pill px-2.5 py-[3px] font-mono text-[9px] uppercase tracking-[0.08em] ${PILL[status]}`;
  if (!onClick) return <span className={cls}>{status}</span>;
  return (
    <button type="button" onClick={onClick} title="Change status" className={`cursor-pointer ${cls}`}>
      {status}
    </button>
  );
}
