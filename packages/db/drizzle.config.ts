import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Load the repo-root .env (packages/db -> ../../.env)
config({ path: "../../.env" });

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Neon: the Vercel integration sets a pooled DATABASE_URL for the app and an
    // unpooled one for DDL; migrations must use the direct connection. Local
    // docker has only DATABASE_URL, so fall back to it.
    url: (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL)!,
  },
});
