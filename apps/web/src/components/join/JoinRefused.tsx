import { SignOutButton } from "@clerk/nextjs";
import type { JoinRefusal } from "@rv-trip/db";
import {
  KEYLESS_SWITCH_HINT,
  SWITCH_ACCOUNT_CTA,
  refusalCopy,
} from "@/components/join/join-view";

/**
 * `/join/<token>`'s refusal card (#77 · docs/design/81 §4) — Q4 = A: the
 * refusal is loud and reversible; a merge we regret is not.
 *
 * A server component, and the whole card is static: which words to draw is
 * `refusalCopy` (a pure function with its own test) and the only interactive
 * thing on it is Clerk's own `SignOutButton`, which is a client component the
 * package exports. Nothing here fetches, and the warning rail is the
 * `border-l-[3px] border-l-rv-warning` idiom `RouteView.tsx:622` already uses.
 *
 * `redirectUrl` is this very page: she signs out, Clerk's hosted sign-in takes
 * her (the proxy protects `/join`), and the link resolves again against the
 * account she picks — which is exactly what the footer promises, since a
 * refused join never stamped `redeemed_at`.
 */
export interface JoinRefusedProps {
  code: JoinRefusal;
  /** The person whose household this is, so the copy can name them. */
  inviter: string;
  /** Where "Use a different account" comes back to — `/join/<token>`. */
  path: string;
  /** False in a keyless process: there is no account to sign out of. */
  canSwitchAccount: boolean;
}

export function JoinRefused({ code, inviter, path, canSwitchAccount }: JoinRefusedProps) {
  const copy = refusalCopy(code, inviter);
  return (
    <div className="max-w-[430px] rounded-rv-card border border-l-[3px] border-rv-border border-l-rv-warning bg-rv-surface px-[17px] py-[15px] shadow-rv-sm">
      <div className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.09em] text-rv-warning">
        {copy.tag}
      </div>
      <h1 className="mb-1.5 text-[19px] font-extrabold tracking-[-0.015em] text-rv-ink">
        {copy.title}
      </h1>
      <p className="text-[13px] leading-[1.6] text-rv-ink-muted">{copy.body}</p>
      {copy.action === "switch-account" && (
        <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
          {canSwitchAccount ? (
            <SignOutButton redirectUrl={path}>
              <button type="button" className={SWITCH_CLASS}>
                {SWITCH_ACCOUNT_CTA}
              </button>
            </SignOutButton>
          ) : (
            <button type="button" disabled title={KEYLESS_SWITCH_HINT} className={SWITCH_CLASS}>
              {SWITCH_ACCOUNT_CTA}
            </button>
          )}
        </div>
      )}
      {copy.footer && (
        <div className="mt-3 font-mono text-[10.5px] text-rv-ink-faded">{copy.footer}</div>
      )}
    </div>
  );
}

/** The wireframe's ghost button, written out once — the same metrics the
 * Household card's "Cancel invite" and "Remove" already use. */
const SWITCH_CLASS =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-rv-md border border-rv-border bg-transparent px-3 py-1.5 text-[12.5px] font-semibold text-rv-ink-muted hover:text-rv-ink disabled:cursor-not-allowed disabled:opacity-50";
