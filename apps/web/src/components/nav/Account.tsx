"use client";

import { ChevronDown } from "lucide-react";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";

/**
 * The masthead's account control. Inlined at build time: with a publishable
 * key the real Clerk menu renders (avatar → manage account / sign out; signed
 * out → a sign-in button that opens Clerk's modal). Without one it is the
 * dev-user stub — visibly a stub, so nobody mistakes a keyless walk for auth.
 */
const CLERK = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function Account() {
  if (!CLERK) return <DevAccount />;
  return (
    <>
      <Show when="signed-in">
        <UserButton
          appearance={{
            elements: {
              // Match the 30px avatar the stub draws; the pill border is ours.
              userButtonAvatarBox: "size-[30px] border-2 border-rv-border-hi",
            },
          }}
        />
      </Show>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button
            type="button"
            className="inline-flex cursor-pointer items-center rounded-rv-pill border border-rv-border bg-transparent px-3 py-1.5 text-[13px] font-semibold text-rv-ink-muted hover:text-rv-ink"
          >
            Sign in
          </button>
        </SignInButton>
      </Show>
    </>
  );
}

function DevAccount() {
  return (
    <span
      title="Local dev — no Clerk keys, running as the seeded dev-user"
      className="inline-flex items-center gap-2 rounded-rv-pill border border-dashed border-rv-border bg-transparent py-1 pl-[5px] pr-2.5"
    >
      <span className="inline-flex size-[30px] items-center justify-center rounded-full border-2 border-rv-border-hi bg-rv-green font-mono text-[12px] font-bold text-rv-navy">
        D
      </span>
      <span className="text-[13px] font-semibold text-rv-ink-muted">dev-user</span>
      <ChevronDown className="size-[13px] text-rv-ink-subtle" />
    </span>
  );
}
