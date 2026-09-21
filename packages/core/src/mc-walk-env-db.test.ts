import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * `engine_db_url` in `scripts/mc-walk-env.sh` — which database a walk runs
 * against, and why (mc-dev #154 · seeded template #155).
 *
 * A schema-touching slice now gets its OWN Postgres: mc-dev stands the
 * `walk.compose` tier up in its own compose project and hands this script the
 * assembled DSN as `MC_WALK_DB_URL` (see `.mc/config.yaml walk.compose` — the
 * `{db_port}` in `walk_db_url` is resolved late precisely because rv-trip
 * declares no `api` service, so the consumer of that DSN is a HOST process).
 *
 * The seam is worth a harness for two reasons, and they pull in opposite
 * directions:
 *
 *   1. ABSENT ⇒ BYTE-IDENTICAL. Every walk that is not schema-touching must
 *      derive its DSN exactly as it always has. A tier that leaks into the
 *      shared path is a change to every walk we run.
 *   2. NEVER SILENT. When `MC_WALK_DB_URL` is set and nothing answers on it,
 *      the standup falls back to the shared database ON PURPOSE — a walk the
 *      operator knows is shared beats no walk at all — but a walk that is
 *      shared while PRESENTING as isolated is the exact bug the tier exists to
 *      remove. So `unreachable` is its own rule, distinct from `off`, and the
 *      caller renders it loudly in the standup output and records it in
 *      `.mc/walk/<issue>.json`.
 *
 * Testing style is `mc-walk-env.test.ts`'s, for its reasons: `packages/core` is
 * where this repo's pure logic is tested, it has no `vitest.config` so a new
 * `src/*.test.ts` is collected with no config change, and `node:child_process`
 * plus `node:net` need no new dependency. The shell function is not importable,
 * so the script exposes an un-advertised `__engine-db-url [attempts]` verb that
 * is exactly this seam.
 *
 * Hermetic: a real listening socket on an ephemeral port is the only "reachable
 * database" here. No docker, no Postgres, no compose project, no standup — the
 * probe is a TCP connect and that is all this rung claims to prove.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = join(REPO, "scripts/mc-walk-env.sh");

const servers: Server[] = [];
afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((done) => s.close(() => done()))));
});

/** A socket that accepts connections and does nothing else, on a free port. */
async function listening(): Promise<number> {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  return addr.port;
}

/** A port nothing is listening on — opened, read, then closed. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  const { port } = addr;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

/**
 * Run the seam. `attempts` is 1 everywhere below: the retry loop is the
 * standup's patience for a container that is still coming up, and paying it
 * here would only make the suite slow.
 */
function engineDbUrl(env: Record<string, string>, attempts = 1): [string, string] {
  const out = execFileSync("bash", [SCRIPT, "__engine-db-url", String(attempts)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    // A clean environment: an ambient MC_WALK_* from the operator's own shell
    // would make the `off` rows pass for the wrong reason.
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
  });
  expect(out.split("\n").filter(Boolean), "stdout is exactly one line").toHaveLength(1);
  const [rule = "", dsn = ""] = out.replace(/\n$/, "").split("\t");
  return [rule, dsn];
}

describe("off — absent config is the off switch", () => {
  it("answers `off` with no MC_WALK_DB_URL at all", () => {
    expect(engineDbUrl({})).toEqual(["off", ""]);
  });

  it("answers `off` on the shared tier even when a DSN rides along", async () => {
    // mc-dev exports MC_WALK_ISSUE/ISOLATION on every tier; only the isolated
    // ones carry a db. Belt: a stale DSN on a shared walk must not be adopted.
    const port = await listening();
    expect(
      engineDbUrl({
        MC_WALK_ISOLATION: "shared",
        MC_WALK_DB_URL: `postgres://rvtrip:rvtrip@127.0.0.1:${port}/rvtrip`,
      }),
    ).toEqual(["off", ""]);
  });
});

describe("isolated — the engine's database answered", () => {
  it("adopts MC_WALK_DB_URL when something is listening on its port", async () => {
    const port = await listening();
    const dsn = `postgres://rvtrip:rvtrip@127.0.0.1:${port}/rvtrip`;

    expect(engineDbUrl({ MC_WALK_ISOLATION: "schema", MC_WALK_DB_URL: dsn })).toEqual([
      "isolated",
      dsn,
    ]);
  });

  it("reads the port out of the DSN, not out of a second variable", async () => {
    // MC_WALK_DB_PORT is also exported by the engine. The seam must not depend
    // on it: `walk_db_url` is the one field that carries the whole connection,
    // and re-deriving a DSN per walk is the improv this tier retires.
    const port = await listening();
    const dsn = `postgres://rvtrip:rvtrip@localhost:${port}/rvtrip`;

    expect(
      engineDbUrl({ MC_WALK_ISOLATION: "schema", MC_WALK_DB_URL: dsn, MC_WALK_DB_PORT: "1" }),
    ).toEqual(["isolated", dsn]);
  });
});

describe("unreachable — set but not answering, and said so", () => {
  it("answers `unreachable` when nothing is listening on the DSN's port", async () => {
    const port = await closedPort();
    const dsn = `postgres://rvtrip:rvtrip@127.0.0.1:${port}/rvtrip`;

    // The DSN rides back on this rule too: the caller puts it in the note, so
    // the operator can see WHICH database failed to answer.
    expect(engineDbUrl({ MC_WALK_ISOLATION: "schema", MC_WALK_DB_URL: dsn })).toEqual([
      "unreachable",
      dsn,
    ]);
  });

  it("answers `unreachable` rather than dying on a DSN with no host or port", () => {
    // `walk_db_url` is consumer-authored YAML; a typo there must degrade to the
    // shared database with a note, never wedge the standup under `set -e`.
    const dsn = "postgres:///rvtrip";

    expect(engineDbUrl({ MC_WALK_ISOLATION: "schema", MC_WALK_DB_URL: dsn })).toEqual([
      "unreachable",
      dsn,
    ]);
  });
});
