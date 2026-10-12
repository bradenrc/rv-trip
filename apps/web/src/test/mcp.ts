import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { db, schema } from "@rv-trip/db";
import { POST } from "@/app/api/mcp/route";

/**
 * The MCP endpoint through the REAL SDK client, in-process: the transport's
 * `fetch` is the route handler, so there is no server and no port. Shared by
 * every tool test (#162 vet MED — it was file-local to mcp-endpoint.test.ts).
 *
 * Like ./db.ts's helpers it reaches `@rv-trip/db`, so import it only from a
 * file that runs under `describeDb`.
 */
export async function connect(bearer?: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL("http://test.local/api/mcp"), {
    fetch: (url, init) => POST(new Request(url, init)),
    requestInit: bearer ? { headers: { authorization: `Bearer ${bearer}` } } : undefined,
  });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  return client;
}

/** A household with `userId` as a member — a key's minter must be one. */
export async function household(id: string, userId: string): Promise<void> {
  await db.insert(schema.households).values({ id }).onConflictDoNothing();
  await db.insert(schema.householdMembers).values({ householdId: id, userId, role: "owner" }).onConflictDoNothing();
}

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

/** A tool result's one text block. */
export const text = (r: ToolResult): string => (r.content as { type: string; text: string }[]).map((c) => c.text).join("");

/** …parsed: every successful tool answers JSON text. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const json = (r: ToolResult): any => JSON.parse(text(r));

/** Call a tool and parse its answer — failing loudly on an `isError`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function call(client: Client, name: string, args: Record<string, unknown>): Promise<any> {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name} → isError: ${text(r)}`);
  return json(r);
}
