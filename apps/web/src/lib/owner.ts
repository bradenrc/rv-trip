/**
 * The current tenant. Local-dev stub — returns the seeded dev owner. This is
 * the seam where Clerk drops in later (read the authed userId from the session);
 * every DB write is already scoped by this value.
 */
export function getOwner(): string {
  return "dev-user";
}
