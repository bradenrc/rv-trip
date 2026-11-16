import Link from "next/link";
import { ChevronRight } from "lucide-react";

/**
 * /you's card language (#173 · docs/design/173 "The /you page, row by row"):
 * the Settings page's card — surface, border, rv-card radius, shadow-rv-sm —
 * with border-soft hairlines between rows. Labels are ink, values ink-faded,
 * the chevron ink-subtle, and the account rows ink-muted.
 *
 * No directive: the server page and the client account island both draw these.
 */
export function YouCard({ dashed = false, children }: { dashed?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`mb-3.5 rounded-rv-card border border-rv-border bg-rv-surface shadow-rv-sm ${dashed ? "border-dashed" : ""}`}
    >
      {children}
    </div>
  );
}

/** One row's box: 14px × 16px, the hairline above every row but the first. */
export const ROW =
  "flex w-full items-center gap-3 border-t border-rv-border-soft px-4 py-3.5 text-left text-[14.5px] font-semibold first:border-t-0";

/**
 * The row chevron, drawn only when the value does not already carry one. An
 * icon, not a "›" glyph: the subtle ink is a non-text role (the token sweeps
 * allow it only on sized icons), and the design puts the chevron in it.
 */
export function Chevron() {
  return <ChevronRight className="ml-auto size-4 text-rv-ink-subtle" />;
}

/**
 * A row that navigates. `value`, when given, is drawn in ink-faded and is
 * expected to carry its own "›" (`homeBaseRowValue` does) — so no second
 * chevron is added beside it (vet MED, double chevron).
 */
export function YouLinkRow({ href, label, value }: { href: string; label: string; value?: string }) {
  return (
    <Link href={href} className={`${ROW} text-rv-ink`}>
      {label}
      {value ? <span className="ml-auto font-normal text-rv-ink-faded">{value}</span> : <Chevron />}
    </Link>
  );
}
