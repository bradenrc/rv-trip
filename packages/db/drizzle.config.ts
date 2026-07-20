import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Load the repo-root .env (packages/db -> ../../.env)
config({ path: "../../.env" });

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
