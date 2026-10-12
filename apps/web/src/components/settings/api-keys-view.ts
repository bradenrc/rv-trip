import { utcMonthDay } from "@/components/settings/household-view";

/**
 * Everything the API keys card DECIDES (#162 · Q8 A · docs/design/162 §5), as
 * plain functions over plain data — the `household-view.ts` split, for the same
 * reason: this repo has no DOM test environment, so the card's states and
 * every string it prints live here, where `api-keys-view.test.ts` executes
 * them, and `ApiKeysCard.tsx` holds no branch of its own beyond which frame.
 *
 * Every date is formatted HERE, on the server, in UTC — the card is a
 * "use client" component and must hydrate the markup the server sent.
 */

/* ── the copy, verbatim from the wireframe ─────────────────────────────── */

export const API_KEYS_TITLE = "API keys";
export const API_KEYS_HELP =
  "Let an AI session (Claude Code, the Claude API) read and add to this household's trips. " +
  "A key acts as the person who minted it, and stops working if they leave the household.";
export const NO_KEYS = "No keys yet.";
export const MINT_A_KEY_CTA = "Mint a key";
export const MINT_CTA = "Mint";
export const CANCEL_CTA = "Cancel";
export const REVOKE_CTA = "Revoke";
export const REVOKE_KEY_CTA = "Revoke key";
export const KEEP_CTA = "Keep";
export const DONE_CTA = "Done";
export const COPY_KEY_CTA = "Copy";
export const SHOWN_ONCE = "This is the only time the full key is shown. Copy it now.";

/** "Key minted: Claude Code · laptop". */
export function mintedLabel(name: string): string {
  return `Key minted: ${name}`;
}

/** The confirm's sentence, split around the bolded name. */
export const REVOKE_CONFIRM = { before: "Revoke ", after: "? Its next call fails. This can't be undone." } as const;

/* ── one key row ───────────────────────────────────────────────────────── */

/**
 * What a row shows — finished strings only. Never the hash, never the key:
 * the server read hands the client nothing it does not draw (vet MED).
 */
export interface ApiKeyRowProps {
  id: string;
  name: string;
  /** `rvk_Q7m2Xa9p…` — the stored 12-char prefix, then an ellipsis. */
  prefix: string;
  /** "Braden · used 2 min ago" · "Jess · never used" · "Braden · revoked Oct 11". */
  meta: string;
  revoked: boolean;
}

/** "used 2 min ago" — coarse on purpose; the row says roughly when, not a timestamp. */
export function usedLabel(lastUsedAt: Date | null, now: Date): string {
  if (!lastUsedAt) return "never used";
  const mins = Math.floor((now.getTime() - lastUsedAt.getTime()) / 60_000);
  if (mins < 1) return "used just now";
  if (mins < 60) return `used ${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `used ${hours} h ago`;
  return `used ${utcMonthDay(lastUsedAt)}`;
}

export function apiKeyView(
  row: { id: string; name: string; prefix: string; lastUsedAt: Date | null; revokedAt: Date | null },
  minter: string,
  now: Date,
): ApiKeyRowProps {
  const when = row.revokedAt ? `revoked ${utcMonthDay(row.revokedAt)}` : usedLabel(row.lastUsedAt, now);
  return {
    id: row.id,
    name: row.name,
    prefix: `${row.prefix}…`,
    meta: `${row.prefix}… · ${minter} · ${when}`,
    revoked: row.revokedAt !== null,
  };
}

/* ── the frames ────────────────────────────────────────────────────────── */

/** a · empty, b · naming, c · minted (shown once), d · list (+ e · a confirm open on one row). */
export type ApiKeysCardFrame = "empty" | "naming" | "minted" | "list";

export function apiKeysCardFrame(s: { keyCount: number; naming: boolean; minted: boolean }): ApiKeysCardFrame {
  if (s.minted) return "minted";
  if (s.naming) return "naming";
  return s.keyCount === 0 ? "empty" : "list";
}

/** Mint is disabled while the name is empty — it's the only way to tell two keys apart. */
export function canMint(name: string): boolean {
  return name.trim().length > 0;
}

/** The `claude mcp add` line the minted panel shows, at USER scope (docs/mcp.md). */
export function mcpAddSnippet(mcpUrl: string, key: string): string {
  return `claude mcp add --transport http --scope user tripcaddie ${mcpUrl} \\\n  --header "Authorization: Bearer ${key}"`;
}
