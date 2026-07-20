import { config } from "dotenv";

// Import this FIRST (before ./index.js) so DATABASE_URL is populated before the
// db client module evaluates. ESM evaluates imports in source order.
config({ path: "../../.env" });
