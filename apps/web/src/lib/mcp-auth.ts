import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { findLiveApiKey, touchApiKey } from "@rv-trip/db";
import { clerkEnabled, DEV_HOUSEHOLD, DEV_OWNER } from "@/lib/owner";

/**
 * Who an MCP request acts as (#161 substrate). The same two ids the REST
 * routes resolve through `getOwner()` / `getActor()`, carried on the SDK's
 * `AuthInfo.extra` so every tool reads them from its `extra.authInfo` instead
 * of a request-scoped Clerk session (there is none — the client is Claude
 * Code, not a browser).
 *
 *   keyId        null in keyless mode; otherwise the api_keys row id
 *   householdId  the tenant every query is scoped by (`owner`)
 *   actor        the member attributed in change_log — the key's minter
 */
export interface McpPrincipal {
  keyId: string | null;
  householdId: string;
  actor: string;
}

const KEYLESS_CLIENT = "keyless";

/**
 * The `verifyToken` for mcp-handler's `withMcpAuth`. Returning `undefined`
 * makes the wrapper answer 401 with a WWW-Authenticate challenge.
 *
 * Keyless (no Clerk keys in this process — walks, CI, a bare `pnpm dev`):
 * a request with no bearer is the dev household, the same switch the app
 * uses everywhere. A bearer is honoured in either mode; it is only REQUIRED
 * when Clerk is on.
 */
export async function verifyMcpBearer(_req: Request, bearer?: string): Promise<AuthInfo | undefined> {
  if (bearer) {
    const row = await findLiveApiKey(bearer);
    if (!row) return undefined;
    void touchApiKey(row.id).catch(() => {}); // best-effort; never blocks the call
    const extra: McpPrincipal = { keyId: row.id, householdId: row.householdId, actor: row.createdBy };
    return { token: bearer, clientId: row.id, scopes: [], extra: { ...extra } };
  }
  if (clerkEnabled()) return undefined;
  const extra: McpPrincipal = { keyId: null, householdId: DEV_HOUSEHOLD, actor: DEV_OWNER };
  return { token: "", clientId: KEYLESS_CLIENT, scopes: [], extra: { ...extra } };
}

/** The principal a tool runs as. Missing = the route is mis-wired; throw, never guess a tenant. */
export function principalOf(authInfo: AuthInfo | undefined): McpPrincipal {
  const p = authInfo?.extra as McpPrincipal | undefined;
  if (!p || typeof p.householdId !== "string" || typeof p.actor !== "string") {
    throw new Error("mcp: no auth principal on the request — withMcpAuth must wrap the handler");
  }
  return { keyId: p.keyId ?? null, householdId: p.householdId, actor: p.actor };
}
