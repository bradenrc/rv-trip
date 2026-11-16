"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Show, SignInButton, useUser } from "@clerk/nextjs";

/**
 * The masthead's account control. Inlined at build time: with a publishable
 * key, signed in, it is the 30px initial avatar as a link to /you (#173 · Q1 C;
 * Manage account and Sign out live on that page now, not in Clerk's
 * UserButton menu); signed out it is a sign-in button that opens Clerk's
 * modal. Without a key it is the dev-user stub — visibly a stub, so nobody
 * mistakes a keyless walk for auth — and it links to /you the same way.
 */
const CLERK = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function Account() {
  if (!CLERK) return <DevAccount />;
  return (
    <>
      <Show when="signed-in">
        <YouAvatar />
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

/** The account's initial: the first name, else the username, else the email. */
function initialOf(user: ReturnType<typeof useUser>["user"]): string {
  const source = user?.firstName || user?.username || user?.primaryEmailAddress?.emailAddress || "";
  return source.trim().charAt(0).toUpperCase();
}

/** Signed in: the same 30px initial avatar the stub draws, as a link to /you. */
function YouAvatar() {
  const { user } = useUser();
  return (
    <Link
      href="/you"
      title="You"
      aria-label="You"
      className="inline-flex size-[30px] items-center justify-center rounded-full border-2 border-rv-border-hi bg-rv-green font-mono text-[12px] font-bold text-rv-navy"
    >
      {initialOf(user)}
    </Link>
  );
}

/** Keyless: the shipped dashed pill, now a link to /you. */
function DevAccount() {
  return (
    <Link
      href="/you"
      title="Local dev — no Clerk keys, running as the seeded dev-user"
      className="inline-flex items-center gap-2 rounded-rv-pill border border-dashed border-rv-border bg-transparent py-1 pl-[5px] pr-2.5"
    >
      <span className="inline-flex size-[30px] items-center justify-center rounded-full border-2 border-rv-border-hi bg-rv-green font-mono text-[12px] font-bold text-rv-navy">
        D
      </span>
      <span className="text-[13px] font-semibold text-rv-ink-muted">dev-user</span>
      <ChevronDown className="size-[13px] text-rv-ink-subtle" />
    </Link>
  );
}
