/**
 * `@rv-trip/db/testing` — the API integration harness's database half
 * (issue #30 §4). Import this from a vitest WORKER only: it re-exports the two
 * modules that use the shipped `db` handle, so evaluating it builds the pool at
 * `../index`'s module scope from whatever DATABASE_URL happens to be set.
 *
 * globalSetup runs before that value has been steered, so it imports
 * `@rv-trip/db/testing/lifecycle` directly instead. setup.ts reaches this
 * barrel through `await import(…)`, after it has set DATABASE_URL.
 */
export * from "./lifecycle";
export * from "./truncate";
export * from "./fixtures";
