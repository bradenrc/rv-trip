"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ACCEPT_BODY,
  ACCEPT_KICKER,
  JOIN_CTA,
  NOT_NOW_CTA,
} from "@/components/join/join-view";

/**
 * `/join/<token>`'s accept card (#77 · docs/design/81 §4) — the one screen
 * where a second person joins a household.
 *
 * Every string arrives finished: the server resolved the invite, the inviter
 * and the visitor and formatted the dates in UTC (`app/join/[token]/page.tsx`),
 * so this component holds no branch and no fetch on mount. The only network it
 * ever touches is the button.
 *
 * On 204 it leaves for the trips list, because the household's trips are now
 * hers and that is the answer to "what did joining get me". On a 409 it just
 * refreshes: the server re-reads the invite and draws the matching refusal
 * card, so a stale page (the link was cancelled, or she planned a trip in
 * another tab) cannot keep offering a button that no longer works.
 */
export interface JoinAcceptProps {
  token: string;
  /** "Braden invited you to the Callahan household". */
  title: string;
  /** "signed in as jess@example.com · invite expires Sep 26". */
  signedIn: string;
}

export function JoinAccept({ token, title, signedIn }: JoinAcceptProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function join() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/household/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.status === 204) {
        router.replace("/");
        router.refresh();
        return;
      }
      router.refresh();
    } catch {
      toast.error("That didn't save — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-[430px] rounded-rv-card border border-rv-border bg-rv-surface px-[17px] py-[15px] shadow-rv-sm">
      <div className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-rv-accent">
        {ACCEPT_KICKER}
      </div>
      <h1 className="mb-1.5 text-[19px] font-extrabold tracking-[-0.015em] text-rv-ink">{title}</h1>
      <p className="text-[13px] leading-[1.6] text-rv-ink-muted">{ACCEPT_BODY}</p>
      <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          disabled={busy}
          onClick={join}
          className="inline-flex cursor-pointer items-center gap-[7px] rounded-rv-md border-none bg-rv-accent-deep px-4 py-[9px] text-[13px] font-bold text-rv-accent-ink shadow-rv-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {JOIN_CTA}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => router.push("/")}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-rv-md border border-rv-border bg-transparent px-3 py-1.5 text-[12.5px] font-semibold text-rv-ink-muted hover:text-rv-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {NOT_NOW_CTA}
        </button>
      </div>
      <div className="mt-3 font-mono text-[10.5px] text-rv-ink-faded">{signedIn}</div>
    </div>
  );
}
