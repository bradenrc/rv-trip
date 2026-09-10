/**
 * The globalSetup -> worker channel is typed, or `inject("databaseUrl")` is
 * `unknown` and `turbo typecheck` fails (DoD #2).
 */
declare module "vitest" {
  export interface ProvidedContext {
    /** The run database's URL — or "" , the sentinel that means "no Postgres". */
    databaseUrl: string;
  }
}

export {};
