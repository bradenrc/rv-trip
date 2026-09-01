import type { LucideIcon } from "lucide-react";

/** Titled empty state for routes scaffolded but not yet designed. */
export function StubPage({
  kicker,
  title,
  blurb,
  Icon,
}: {
  kicker: string;
  title: string;
  blurb: string;
  Icon: LucideIcon;
}) {
  return (
    <main className="mx-auto w-full max-w-[1120px] px-7 pb-[72px] pt-9">
      <div className="mb-2 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-rv-ember">
        {kicker}
      </div>
      <h1 className="m-0 mb-8 text-[40px] font-extrabold leading-none tracking-[-0.02em] text-rv-ink">
        {title}
      </h1>
      <div className="flex flex-col items-center justify-center gap-3 rounded-rv-card border border-dashed border-rv-border-hi bg-rv-surface/40 px-6 py-20 text-center">
        <Icon className="size-9 text-rv-ink-subtle" />
        <p className="m-0 max-w-[46ch] text-[15px] text-rv-ink-muted">{blurb}</p>
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-rv-ink-faded">
          Coming soon
        </span>
      </div>
    </main>
  );
}
