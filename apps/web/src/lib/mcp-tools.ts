import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolResult, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";
import { API_KEY_RATE_LIMIT, consumeApiKeyCall } from "@rv-trip/db";
import { principalOf, type McpPrincipal } from "@/lib/mcp-auth";

/**
 * One wrapper every MCP tool goes through (#161 substrate): resolve the
 * principal, charge the rate limit, run, log one line, and turn every failure
 * into an `isError` result the model can read — never a thrown 500.
 *
 * Results are JSON text: one `text` content block holding `JSON.stringify`.
 * Arguments are NOT logged — notes and URLs can be things the user considers
 * private; the log says who called what, whether it worked, and how long.
 */
type ToolRun<Shape extends ZodRawShape> = (
  args: { [K in keyof Shape]: Shape[K]["_output"] },
  principal: McpPrincipal,
) => Promise<unknown>;

export function defineTool<Shape extends ZodRawShape>(
  server: McpServer,
  name: string,
  meta: { title: string; description: string; inputSchema: Shape },
  run: ToolRun<Shape>,
): void {
  // The SDK's `ToolCallback<Shape>` is a conditional type that TS cannot
  // resolve for a generic `Shape`, so the callback is typed concretely and
  // cast once here; `registerTool` still validates `args` against `meta.inputSchema`.
  const callback = async (
    args: Parameters<ToolRun<Shape>>[0],
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  ): Promise<CallToolResult> => {
    const started = Date.now();
    let base: Record<string, unknown> = { at: new Date().toISOString(), tool: name };
    try {
      // Inside the try so a mis-wired route (no principal) still logs a line.
      const principal = principalOf(extra.authInfo);
      base = { ...base, keyId: principal.keyId, householdId: principal.householdId };
      if (principal.keyId) {
        const gate = await consumeApiKeyCall(principal.keyId);
        if (!gate.allowed) {
          const error = `rate limit: ${API_KEY_RATE_LIMIT} calls per minute per key — retry in ${gate.retryAfterSec}s`;
          console.log(JSON.stringify({ ...base, ok: false, ms: Date.now() - started, error }));
          return { isError: true, content: [{ type: "text" as const, text: error }] };
        }
      }
      const result = await run(args, principal);
      console.log(JSON.stringify({ ...base, ok: true, ms: Date.now() - started }));
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (e) {
      // Input validation never reaches here (the SDK parses `inputSchema`
      // before the body runs); what lands is a mutation's own refusal.
      const error = e instanceof Error ? e.message : String(e);
      console.log(JSON.stringify({ ...base, ok: false, ms: Date.now() - started, error }));
      return { isError: true, content: [{ type: "text" as const, text: error }] };
    }
  };
  server.registerTool(name, meta, callback as ToolCallback<Shape>);
}
