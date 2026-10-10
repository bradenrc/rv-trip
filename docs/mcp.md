# TripCaddie MCP — connect an AI session to your household

The app's trip grammar as MCP tools at `https://roadvalet.com/api/mcp`
(streamable HTTP). An AI session pulls your trips, researches, and pushes
ideas back through the same owner-scoped mutations the app uses — every
write is validated and household-scoped. The key carries its minting member
as the actor; the app does not yet record who *created* a thing (History
logs field changes only), so "added by …" for MCP writes lands with #162.

## 1. Mint a key

Keys are per household and minted BY a member; a key stops working the
moment its minter leaves the household. Until the Settings card ships
(#162), mint from a checkout with production's `DATABASE_URL` in the
environment:

```bash
pnpm mcp:key mint --household <householdId> --by <yourClerkUserId> --name "Claude Code"
```

The last line is the key (`rvk_…`). It is shown once. `pnpm mcp:key list
--household <id>` and `pnpm mcp:key revoke <keyId>` manage it; a revoked
key fails on its next call.

## 2. Connect a client

**Claude Code** — add it at USER scope so the key lives in your home
config, never in a repo (a project `.mcp.json` is meant to be committed —
never put a key in one):

```bash
claude mcp add --transport http --scope user tripcaddie https://roadvalet.com/api/mcp \
  --header "Authorization: Bearer rvk_…"
```

If you do want a project-level `.mcp.json`, reference the key through the
environment instead of pasting it:

```json
{
  "mcpServers": {
    "tripcaddie": {
      "type": "http",
      "url": "https://roadvalet.com/api/mcp",
      "headers": { "Authorization": "Bearer ${TRIPCADDIE_MCP_KEY}" }
    }
  }
}
```

**Claude API** — the MCP connector in a Messages request (the connector is
a beta: send the beta header the current Claude API docs name for it):

```json
"mcp_servers": [
  { "type": "url", "url": "https://roadvalet.com/api/mcp", "name": "tripcaddie", "authorization_token": "rvk_…" }
]
```

**claude.ai custom connectors and ChatGPT** — both expect OAuth, not a
pasted bearer. That is #164; until then use Claude Code or the Claude API.

## 3. Smoke test

In the connected session:

> What trips do I have?

→ the household's trips with ids.

> Add an idea to <trip title>: eat at Drayton Harbor Oyster Co., note "best
> oysters near Blaine", source https://example.com/oysters

→ the idea appears on the trip in the app within seconds (History will not
show who added it until #162 records creates).

## Tools (v1)

| tool | does |
|---|---|
| `list_trips` | every trip in the household — call first to get ids |
| `get_trip { tripId }` | the full trip tree |
| `add_idea { tripId, destinationId?, title, category: do\|eat\|stay, notes?, sourceUrl?, clientId? }` | adds an idea; same `clientId` twice returns the existing one |

Limits: 60 tool calls per key per minute. Errors come back as tool results
the model can read, never as HTTP 500s. Every call that reaches a tool is
logged (who, which tool, outcome, duration — never the arguments).

## Local / walks

With no Clerk keys in the process the endpoint needs no bearer and acts as
the seeded `dev-household`:

```bash
curl -s localhost:3000/api/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

With Clerk keys set locally (`apps/web/.env.development.local`), the dev
server requires a bearer like production does. Mint one with `pnpm mcp:key`
— and check both point at the SAME database: the CLI reads the repo-root
`.env`, while `next dev` prefers `apps/web/.env.development.local`. A key
minted into one database is unknown to a server reading the other.
