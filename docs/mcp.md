# TripCaddie MCP — connect an AI session to your household

The app's trip grammar as MCP tools at `https://roadvalet.com/api/mcp`
(streamable HTTP). An AI session pulls your trips, researches, and pushes
ideas back through the same owner-scoped mutations the app uses — every
write is validated and household-scoped. The key carries its minting member
as the actor, and every create writes a `created` row to History (#162), so
the app's byline reads "added by <the minter>" on everything a session adds.

## 1. Mint a key

Keys are per household and minted BY a member; a key stops working the
moment its minter leaves the household. Mint one in the app: **Settings →
Household → API keys → Mint a key**. The full key and the `claude mcp add`
line are shown once; every member sees and can revoke every key there.

From a checkout with production's `DATABASE_URL` in the environment, the CLI
does the same:

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

→ the idea appears on the trip's Ideas tab within seconds, its byline
reading "added by <you>".

## Tools (v1)

| tool | does |
|---|---|
| `list_trips` | every trip in the household — call first to get ids |
| `get_trip { tripId }` | the full trip tree |
| `get_context { tripId }` | the session's first call: a flat digest — every destination, hop and id, open days, destinations with no stay, saves nearby, "last time here". No note or booking bodies (`get_trip` has those) |
| `create_trip { title, startDate, endDate, defaultMode?, lodgingDefault?, rigOn? }` | an empty trip (one chapter, the household home base) → `{ tripId, chapterId, homeBase, replayed }`; same title + start date returns the existing trip |
| `add_destination { tripId, place: string \| {name, lat, lng, googlePlaceId}, arriveDate?, departDate?, chapterId? }` | appends a destination (default: the first chapter). A string place is looked up near the previous destination (else the home base); the typed name is kept and the hit echoed as `resolved` (null when keyless / no hit — saved unmapped). Same place on the same trip returns the existing one |
| `add_segment { tripId, from: destId\|"home", to: destId\|"home", mode }` | sets the mode of an existing adjacent hop; `to: "home"` creates the hop home when there is none (`born: true`; needs a home base) |
| `add_reservation { destinationId \| segmentId, type, name, checkIn?, checkOut?, startsAt?, startsTz?, endsAt?, endsTz?, lodgingKind?, transportKind?, notes?, confirmationNumber?, cost? }` | a booking on a destination or a hop; a stay's check-in/out times render as "in after 4:00 PM · out by 11:00 AM". Same name on the same parent returns the existing one |
| `add_save { anchor: place\|area\|pin, name, type, googlePlaceId? \| areaLabel? \| lat?+lng?, note?, source?, tripId?, clientId? }` | a place in the household library; same `clientId` returns the existing one |
| `add_idea { tripId, destinationId?, title, category: do\|eat\|stay, notes?, sourceUrl?, clientId? }` | adds an idea (it lands on the Ideas tab); same `clientId` twice returns the existing one |
| `journal_entry { target: {kind: idea\|destination\|reservation, id} \| {tripId, destinationId?, title, category}, status?: "done", rating?, again?, notes?, clientId? }` | patch how something went (only an idea takes `status`), or record a never-planned thing as a done idea |

Re-runs never duplicate: a replay answers `replayed: true` and writes
nothing. Nothing deletes.

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
