# TripCaddie MCP — connect an AI session to your household

The app's trip grammar as MCP tools at `https://roadvalet.com/api/mcp`
(streamable HTTP). An AI session pulls your trips, researches, and pushes
ideas back through the same owner-scoped mutations the app uses — every
write is validated and household-scoped, and the key's minting member is the
actor on every write it makes.

## 1. Mint a key

Keys are per household; the member who mints one is the `actor` on every
write it makes. Until the Settings card ships (#162), mint from a checkout
with production's `DATABASE_URL` in the environment:

```bash
pnpm mcp:key mint --household <householdId> --by <yourClerkUserId> --name "Claude Code"
```

The last line is the key (`rvk_…`). It is shown once. `pnpm mcp:key list
--household <id>` and `pnpm mcp:key revoke <keyId>` manage it; a revoked
key fails on its next call.

## 2. Connect a client

**Claude Code** — `.mcp.json` in any project (or `~/.claude.json` for all):

```json
{
  "mcpServers": {
    "tripcaddie": {
      "type": "http",
      "url": "https://roadvalet.com/api/mcp",
      "headers": { "Authorization": "Bearer rvk_…" }
    }
  }
}
```

**Claude API** — the MCP connector in a Messages request:

```json
"mcp_servers": [
  { "type": "url", "url": "https://roadvalet.com/api/mcp", "name": "tripcaddie", "authorization_token": "rvk_…" }
]
```

**claude.ai custom connector** — Settings → Connectors → Add custom
connector → URL `https://roadvalet.com/api/mcp`. Where the dialog offers an
OAuth client id/secret, leave them blank; paste the key as a bearer if the
field is offered. If your plan's connector dialog only accepts OAuth, that
is #164.

**ChatGPT** — waits for OAuth (#164).

## 3. Smoke test

In the connected session:

> What trips do I have?

→ the household's trips with ids.

> Add an idea to <trip title>: eat at Drayton Harbor Oyster Co., note "best
> oysters near Blaine", source https://example.com/oysters

→ the idea appears on the trip in the app within seconds.

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
server requires a bearer like production does — mint one against the local
DB with `pnpm mcp:key`.
