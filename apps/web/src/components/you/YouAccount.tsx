"use client";

import { SignOutButton, useClerk } from "@clerk/nextjs";
import { Chevron, ROW, YouCard } from "./rows";

/**
 * /you's second card (#173 · Q1 C). The avatar link replaced Clerk's
 * UserButton, which was the web's only Manage account and Sign out; both move
 * here as Clerk-only rows. Keyless, it is the dev-user stub with the copy
 * Account.tsx's DevAccount carries as its title.
 *
 * `clerk` is decided on the server with the same `clerkEnabled()` that mounts
 * <ClerkProvider> in layout.tsx, so the Clerk hooks only run under a provider.
 */
export function YouAccount({ clerk }: { clerk: boolean }) {
  return clerk ? <ClerkAccount /> : <DevAccountStub />;
}

function ClerkAccount() {
  const { openUserProfile } = useClerk();
  return (
    <YouCard>
      <button type="button" onClick={() => openUserProfile()} className={`${ROW} cursor-pointer text-rv-ink-muted`}>
        Manage account
        <Chevron />
      </button>
      <SignOutButton>
        <button type="button" className={`${ROW} cursor-pointer text-rv-ink-muted`}>
          Sign out
        </button>
      </SignOutButton>
    </YouCard>
  );
}

function DevAccountStub() {
  return (
    <YouCard dashed>
      <div className={`${ROW} text-rv-ink-muted`}>
        <span>
          dev-user
          <span className="block text-[12.5px] font-normal text-rv-ink-faded">
            Local dev — no Clerk keys, running as the seeded dev-user
          </span>
        </span>
      </div>
    </YouCard>
  );
}
