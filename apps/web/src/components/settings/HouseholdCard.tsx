"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Card, GroupKicker, Row } from "@/components/settings/SettingsForm";
import {
  CANCEL_CTA,
  COPIED_CTA,
  COPY_CTA,
  INVITE_CTA,
  INVITE_HELP,
  INVITE_TITLE,
  KEYLESS_HINT,
  PENDING_NAME,
  REMOVE_CTA,
  SHARED_HELP,
  SOLO_HELP,
  SOLO_TITLE,
  householdCardState,
  type HouseholdInviteProps,
  type HouseholdMemberProps,
} from "@/components/settings/household-view";

/**
 * Settings → Household (#77 · docs/design/81 §3) — the fourth card on a page
 * that already had three.
 *
 * Composed, never restyled: `GroupKicker`, `Card` and `Row` are the very shapes
 * the other three groups are built from, imported from `SettingsForm` rather
 * than re-declared, so the four cards cannot drift apart. Everything new here
 * is a member line, a pill and two buttons.
 *
 * It renders PURELY from its props. The server reads the household, its members
 * and the live invite (`app/settings/page.tsx`) on the same seam the page
 * already uses for prefs; nothing is fetched on mount, and every date arrived
 * pre-formatted in UTC so this component cannot disagree with the HTML the
 * server sent. Which of the three states to draw is `householdCardState`, a
 * pure function with its own test — this file holds no branch that file does
 * not cover.
 */
export interface HouseholdCardProps {
  /** The household's name — shown only once there are two of you; the solo
   * state is called after what it is ("Just you"), not after a name nobody has
   * chosen yet. */
  name: string;
  members: HouseholdMemberProps[];
  invite: HouseholdInviteProps | null;
  /** False in a keyless process: there is no identity provider, so there is
   * nobody to invite. The button stays visible and goes dead, the way
   * `Account.tsx`'s `DevAccount` stub stays visible. */
  canInvite: boolean;
}

export function HouseholdCard({ name, members, invite, canInvite }: HouseholdCardProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const state = householdCardState({ memberCount: members.length, hasInvite: invite !== null });
  const live = state === "invited" ? invite : null;

  async function run(path: string, method: "POST" | "DELETE") {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(path, { method });
      if (!res.ok) throw new Error(String(res.status));
      // The card is server-rendered, so the new state comes from the same read
      // that drew it — no second source of truth on the client.
      router.refresh();
    } catch {
      toast.error("That didn't save — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(href: string) {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the link and copy it by hand.");
    }
  }

  return (
    <>
      <GroupKicker>Household</GroupKicker>
      <Card>
        {state === "solo" && <Row label={SOLO_TITLE} help={SOLO_HELP} />}
        {state === "shared" && <Row label={name} help={SHARED_HELP} />}
        {live && (
          <Row label={INVITE_TITLE} help={INVITE_HELP}>
            <div className="flex flex-wrap items-center gap-2.5 rounded-rv-md border border-rv-border bg-rv-surface-alt py-[7px] pl-[11px] pr-[9px] font-mono text-[12.5px] text-rv-ink-muted">
              <span className="min-w-0 break-all">{live.display}</span>
              <button
                type="button"
                onClick={() => copyLink(live.href)}
                className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-rv-md border border-rv-border bg-transparent px-3 py-1.5 text-[12.5px] font-semibold text-rv-ink-muted hover:text-rv-ink"
              >
                {copied ? COPIED_CTA : COPY_CTA}
              </button>
            </div>
          </Row>
        )}

        <Row>
          {members.map((member) => (
            <MemberLine
              key={member.userId}
              member={member}
              onRemove={
                member.isYou || member.role === "owner"
                  ? undefined
                  : () =>
                      run(
                        `/api/household/members/${encodeURIComponent(member.userId)}`,
                        "DELETE",
                      )
              }
              busy={busy}
            />
          ))}
          {live && <PendingLine windowLabel={live.windowLabel} />}
        </Row>

        {state === "solo" && (
          <Row>
            <button
              type="button"
              disabled={!canInvite || busy}
              {...(canInvite ? {} : { title: KEYLESS_HINT })}
              onClick={() => run("/api/household/invites", "POST")}
              className="inline-flex cursor-pointer items-center gap-[7px] rounded-rv-md border-none bg-rv-accent-deep px-4 py-[9px] text-[13px] font-bold text-rv-accent-ink shadow-rv-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="size-[15px]" fill="currentColor" strokeWidth={2.5} />
              {INVITE_CTA}
            </button>
          </Row>
        )}

        {live && (
          <Row>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(`/api/household/invites/${encodeURIComponent(live.token)}`, "DELETE")}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-rv-md border border-rv-border bg-transparent px-3 py-1.5 text-[12.5px] font-semibold text-rv-ink-muted hover:text-rv-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              {CANCEL_CTA}
            </button>
          </Row>
        )}
      </Card>
    </>
  );
}

/** The two member pills of §3, written out rather than composed: Tailwind reads
 * source text, so a class name assembled from a variable would never be
 * generated. Navy for you, and the app's verified green for a co-pilot who has
 * actually joined — the same green `StatusPill` reserves for done. */
const PILL_TONE: Record<HouseholdMemberProps["pillTone"], string> = {
  owner: "border-rv-navy-soft bg-rv-navy-soft text-rv-ink",
  joined: "border-rv-green bg-rv-green-soft text-rv-green-ink",
};

/** One person: the 30px monogram, name over email, and the pill that says who
 * they are to the household. `Remove` appears only beside a co-pilot — never
 * beside you and never beside the owner. */
function MemberLine({
  member,
  onRemove,
  busy,
}: {
  member: HouseholdMemberProps;
  onRemove?: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 py-[7px]">
      <span className="inline-flex size-[30px] flex-none items-center justify-center rounded-rv-pill border-2 border-rv-border-hi bg-rv-navy-soft font-mono text-[12px] font-bold text-rv-ink">
        {member.initial}
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold text-rv-ink">{member.name}</span>
        <span className="block break-all font-mono text-[11.5px] text-rv-ink-faded">
          {member.detail}
        </span>
      </span>
      <span
        className={`ml-auto whitespace-nowrap rounded-rv-pill border px-2.5 py-[3px] font-mono text-[9px] uppercase tracking-[0.08em] ${PILL_TONE[member.pillTone]}`}
      >
        {member.pill}
      </span>
      {onRemove && (
        <button
          type="button"
          disabled={busy}
          onClick={onRemove}
          className="ml-2.5 inline-flex cursor-pointer items-center gap-1.5 rounded-rv-md border border-rv-border bg-transparent px-3 py-1.5 text-[12.5px] font-semibold text-rv-ink-muted hover:text-rv-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {REMOVE_CTA}
        </button>
      )}
    </div>
  );
}

/** The seat waiting to be taken: a dashed monogram with no letter in it, and
 * the window the link lives in. */
function PendingLine({ windowLabel }: { windowLabel: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 py-[7px]">
      <span className="inline-flex size-[30px] flex-none items-center justify-center rounded-rv-pill border-2 border-dashed border-rv-border bg-transparent font-mono text-[12px] font-bold text-rv-ink-subtle">
        ?
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold text-rv-ink-muted">{PENDING_NAME}</span>
        <span className="block font-mono text-[11.5px] text-rv-ink-faded">{windowLabel}</span>
      </span>
      <span className="ml-auto whitespace-nowrap rounded-rv-pill border border-rv-warning bg-rv-warning-soft px-2.5 py-[3px] font-mono text-[9px] uppercase tracking-[0.08em] text-rv-warning">
        pending
      </span>
    </div>
  );
}
