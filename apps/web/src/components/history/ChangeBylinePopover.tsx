"use client";

import { useEffect, useState } from "react";
import { changeHistoryRow } from "@rv-trip/core";
import type { ChangeEntity, ChangeHistoryRow, LastChange } from "@rv-trip/core";
import { ChangeByline, ChangeHistoryList } from "@rv-trip/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * The byline, with the popover it opens (#78 · docs/design/81 §5).
 *
 * The SPLIT is the point: `ChangeByline` (the DS) draws the closed line from
 * the `lastChange` the list read already carried, and this app component adds
 * the two things `packages/ui` cannot have — radix's Popover (the kit has no
 * radix dependency, and adding one is what i7's acceptance forbids) and the
 * network (no DS component fetches; `GoogleLine` set the same precedent).
 *
 * The audit list is fetched ONLY when the line is opened, which is what keeps a
 * row read one joined row: a page of twenty cards makes zero history requests
 * until someone actually asks.
 */
export function ChangeBylinePopover({
  last,
  entity,
  entityId,
  name,
}: {
  /** null → nothing renders at all, and nothing is ever fetched. */
  last: LastChange | null;
  entity: ChangeEntity;
  entityId: string;
  /** The thing the history is about — the popover's header names it. */
  name: string;
}) {
  const [open, setOpen] = useState(false);
  /**
   * ONE piece of state, keyed by the id it answers for, so "in flight" is
   * derived rather than a second flag that can disagree with the first — the
   * shape `GoogleLine` already uses.
   */
  const [answer, setAnswer] = useState<{ id: string; rows: ChangeHistoryRow[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void fetch(`/api/history?entity=${entity}&id=${encodeURIComponent(entityId)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((body) => {
        if (!live) return;
        // A 404 (not this household's), a 400 or a shape we do not recognise
        // all land the same way: the panel shows its header and no rows,
        // never a raw error inside a hover card.
        const parsed = changeHistoryRow.array().safeParse(body);
        setAnswer({ id: entityId, rows: parsed.success ? parsed.data : [] });
      })
      .catch(() => {
        if (live) setAnswer({ id: entityId, rows: [] });
      });
    return () => {
      live = false;
    };
  }, [open, entity, entityId]);

  if (!last) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ChangeByline last={last} open={open} />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto max-w-[390px] gap-0 rounded-rv-card border border-rv-border bg-rv-surface px-[13px] py-[11px] shadow-rv-xl ring-0"
      >
        <ChangeHistoryList name={name} rows={answer?.id === entityId ? answer.rows : []} />
      </PopoverContent>
    </Popover>
  );
}
