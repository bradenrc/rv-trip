import { describe, inject } from "vitest";

/**
 * The Q4 skip gate and the two request helpers every handler test uses
 * (issue #30 §5).
 *
 * Why a sentinel rather than an unset variable: `describe.skip` still evaluates
 * the file, so its `import { PATCH } from "@/app/api/…"` still pulls in
 * @rv-trip/db, which throws at module scope on a missing DATABASE_URL. Skipping
 * has to be a value the harness passes, not the absence of a connection string.
 */
const available = inject("databaseUrl") !== "";

/** Use this, never bare `describe`, in any file that touches the db. */
export const describeDb = available ? describe : describe.skip;

/** A `Request` for a direct handler call. No server, no port, no fetch. */
export const req = (body?: unknown, method = "POST") =>
  new Request("http://test.local/", {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** `ctx.params` is a Promise in Next 16 — every handler awaits it. */
export const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
