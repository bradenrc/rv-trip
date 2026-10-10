import { afterEach, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { API_KEY_RATE_LIMIT, consumeApiKeyCall, createApiKey, db, schema } from "@rv-trip/db";
import { DEV_OWNER, OTHER_OWNER, fx } from "@rv-trip/db/testing";
import { POST } from "@/app/api/mcp/route";
import { describeDb } from "@/test/db";

/**
 * The endpoint through the REAL SDK client, in-process: the transport's
 * `fetch` is the route handler, so there is no server and no port.
 */
vi.mock("@/lib/places", () => ({
  areaResolver: () => async () => null,
  placesProvider: () => ({ configured: false, provider: null }),
}));

async function connect(bearer?: string) {
  const transport = new StreamableHTTPClientTransport(new URL("http://test.local/api/mcp"), {
    fetch: (url, init) => POST(new Request(url, init)),
    requestInit: bearer ? { headers: { authorization: `Bearer ${bearer}` } } : undefined,
  });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  return client;
}

function clerkOn() {
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_dummy";
  process.env.CLERK_SECRET_KEY = "sk_test_dummy";
}
afterEach(() => {
  delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  delete process.env.CLERK_SECRET_KEY;
});

const text = (r: Awaited<ReturnType<Client["callTool"]>>) =>
  (r.content as { type: string; text: string }[]).map((c) => c.text).join("");
const json = (r: Awaited<ReturnType<Client["callTool"]>>) => JSON.parse(text(r));

describeDb("MCP endpoint (#161 substrate)", () => {
  it("keyless: lists the three tools and reads the dev household's trips", async () => {
    const { trip } = await fx.pacificNorthwestLoop();
    const client = await connect();
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(["add_idea", "get_trip", "list_trips"]);
    const list = json(await client.callTool({ name: "list_trips", arguments: {} }));
    expect(list.map((t: { id: string }) => t.id)).toEqual([trip.id]);
    const full = json(await client.callTool({ name: "get_trip", arguments: { tripId: trip.id } }));
    expect(full.title).toBe("Pacific Northwest Loop");
    expect(full.chapters.length).toBeGreaterThan(0);
  });

  it("requires a bearer when Clerk is on (401 challenge, not a redirect)", async () => {
    clerkOn();
    const res = await POST(
      new Request("http://test.local/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer /);
  });

  it("scopes get_trip to the key's household", async () => {
    clerkOn();
    await db.insert(schema.households).values([{ id: DEV_OWNER }, { id: OTHER_OWNER }]).onConflictDoNothing();
    const mine = await fx.trip({ owner: DEV_OWNER, title: "Mine" });
    const theirs = await fx.trip({ owner: OTHER_OWNER, title: "Theirs" });
    const { key } = await createApiKey(DEV_OWNER, { name: "k", createdBy: "user_braden" });
    const client = await connect(key);
    expect(json(await client.callTool({ name: "list_trips", arguments: {} })).map((t: { title: string }) => t.title)).toEqual(["Mine"]);
    expect(json(await client.callTool({ name: "get_trip", arguments: { tripId: mine.id } })).title).toBe("Mine");
    const other = await client.callTool({ name: "get_trip", arguments: { tripId: theirs.id } });
    expect(other.isError).toBe(true);
    expect(text(other)).toMatch(/trip not found/);
  });

  it("add_idea writes through createIdea: attributed to the key's minter, source link in the notes", async () => {
    clerkOn();
    await db.insert(schema.households).values({ id: DEV_OWNER }).onConflictDoNothing();
    const trip = await fx.trip({ owner: DEV_OWNER });
    const { key } = await createApiKey(DEV_OWNER, { name: "k", createdBy: "user_braden" });
    const client = await connect(key);
    const r = await client.callTool({
      name: "add_idea",
      arguments: { tripId: trip.id, title: "Drayton Harbor Oyster Co.", category: "eat", notes: "best oysters near Blaine", sourceUrl: "https://example.com/oysters" },
    });
    expect(r.isError).toBeFalsy();
    const { idea, replayed } = json(r);
    expect(replayed).toBe(false);
    expect(idea.title).toBe("Drayton Harbor Oyster Co.");
    expect(idea.notes).toBe("best oysters near Blaine\n\nSource: https://example.com/oysters");
    const [row] = await db.select().from(schema.ideas);
    expect(row!.tripId).toBe(trip.id);
    // Idempotent replay rides the mutation's own clientId rule: same id → the
    // existing row, `replayed: true`, and still exactly one idea.
    const again = json(
      await client.callTool({
        name: "add_idea",
        arguments: { tripId: trip.id, title: "Drayton Harbor Oyster Co.", category: "eat", clientId: "cap_1" },
      }),
    );
    expect(again.replayed).toBe(false);
    const third = json(
      await client.callTool({
        name: "add_idea",
        arguments: { tripId: trip.id, title: "Drayton Harbor Oyster Co.", category: "eat", clientId: "cap_1" },
      }),
    );
    expect(third.replayed).toBe(true);
    expect(third.idea.id).toBe(again.idea.id);
    expect((await db.select().from(schema.ideas)).length).toBe(2);
  });

  it("rejects a non-uuid tripId with zod's message and inserts nothing", async () => {
    const client = await connect();
    const r = await client.callTool({ name: "add_idea", arguments: { tripId: "nope", title: "x", category: "do" } });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/uuid/i);
    expect(await db.select().from(schema.ideas)).toEqual([]);
  });

  it("rate limits a key at 60 calls per minute, and never limits keyless", async () => {
    clerkOn();
    await db.insert(schema.households).values({ id: DEV_OWNER }).onConflictDoNothing();
    const { key, row } = await createApiKey(DEV_OWNER, { name: "k", createdBy: "u" });
    for (let i = 0; i < API_KEY_RATE_LIMIT; i++) await consumeApiKeyCall(row.id); // pre-fill this minute
    const client = await connect(key);
    const r = await client.callTool({ name: "list_trips", arguments: {} });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/rate limit.*retry in \d+s/i);
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;
    const keyless = await connect();
    for (let i = 0; i < 3; i++) expect((await keyless.callTool({ name: "list_trips", arguments: {} })).isError).toBeFalsy();
  });

  it("logs one JSON line per tool call without the arguments", async () => {
    // A call that reaches the tool body (the SDK rejects schema failures
    // before any body runs, so those never log): a well-formed id that
    // matches nothing → ok:false, and the id itself must not be in the line.
    const missing = "7f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((s: string) => void lines.push(String(s)));
    try {
      const client = await connect();
      await client.callTool({ name: "get_trip", arguments: { tripId: missing } });
    } finally {
      spy.mockRestore();
    }
    const entries = lines.filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
    const call = entries.find((e) => e.tool === "get_trip");
    expect(call).toMatchObject({ keyId: null, householdId: "dev-household", ok: false, error: "trip not found" });
    expect(typeof call.ms).toBe("number");
    expect(JSON.stringify(call)).not.toContain(missing);
  });
});
