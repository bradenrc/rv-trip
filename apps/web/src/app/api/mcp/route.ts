import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { verifyMcpBearer } from "@/lib/mcp-auth";
import { registerTools } from "@/lib/mcp-server";

/**
 * The MCP endpoint (#161 substrate): streamable HTTP at POST /api/mcp,
 * stateless per request (the adapter builds a fresh McpServer each call, so a
 * Vercel function needs no session store), SSE off (so no Redis).
 *
 * Auth: `withMcpAuth` reads the bearer and answers 401 + WWW-Authenticate
 * when `verifyMcpBearer` returns nothing. `required: true` is what makes a
 * missing key a 401 when Clerk is on; keyless mode still passes because the
 * verifier returns the dev principal for a bare request.
 *
 * The proxy (`src/proxy.ts`) skips this path, so a `rvk_` bearer never meets
 * Clerk's middleware.
 */
export const maxDuration = 60;

const handler = createMcpHandler(
  (server) => registerTools(server),
  { serverInfo: { name: "tripcaddie", version: "0.1.0" } },
  { basePath: "/api", disableSse: true, maxDuration },
);

const authed = withMcpAuth(handler, verifyMcpBearer, { required: true });

export { authed as GET, authed as POST, authed as DELETE };
