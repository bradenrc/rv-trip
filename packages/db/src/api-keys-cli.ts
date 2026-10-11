import "./load-env";
import { createApiKey, listApiKeys, revokeApiKey } from "./api-keys";

/**
 * MCP API keys from the terminal (#161 substrate). The Settings card is #162's;
 * until it ships this is how a key is minted.
 *
 *   pnpm mcp:key mint --household <id> --by <clerkUserId> --name "Claude Code"
 *   pnpm mcp:key list --household <id>
 *   pnpm mcp:key revoke <keyId>
 *
 * `mint` prints the key ONCE, as the last line. It is not stored anywhere.
 * `--by` is the member the key acts as: every write through it is attributed
 * to that user in change_log, exactly like the app.
 */
const USAGE = `usage:
  pnpm mcp:key mint --household <id> --by <userId> --name "<label>"
  pnpm mcp:key list --household <id>
  pnpm mcp:key revoke <keyId>`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "mint") {
    const householdId = flag(rest, "--household");
    const createdBy = flag(rest, "--by");
    const name = flag(rest, "--name") ?? "MCP key";
    if (!householdId || !createdBy) {
      console.error(USAGE);
      return 2;
    }
    const { key, row } = await createApiKey(householdId, { name, createdBy });
    console.error(`minted ${row.prefix}… (${row.id}) for household ${householdId}, acting as ${createdBy}`);
    console.error("the key is shown ONCE — store it in your MCP client config now:");
    console.log(key);
    return 0;
  }
  if (cmd === "list") {
    const householdId = flag(rest, "--household");
    if (!householdId) {
      console.error(USAGE);
      return 2;
    }
    const rows = await listApiKeys(householdId);
    if (rows.length === 0) console.log("(no keys)");
    for (const k of rows) {
      const state = k.revokedAt ? `revoked ${k.revokedAt.toISOString()}` : `last used ${k.lastUsedAt?.toISOString() ?? "never"}`;
      console.log(`${k.id}  ${k.prefix}…  ${k.name}  by ${k.createdBy}  ${state}`);
    }
    return 0;
  }
  if (cmd === "revoke") {
    const [id] = rest;
    if (!id) {
      console.error(USAGE);
      return 2;
    }
    const ok = await revokeApiKey(id);
    console.log(ok ? `revoked ${id}` : `no live key ${id}`);
    return ok ? 0 : 1;
  }
  console.error(USAGE);
  return 2;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
