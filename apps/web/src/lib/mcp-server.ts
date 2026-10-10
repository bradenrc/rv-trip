import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ideaCategory } from "@rv-trip/core";
import { createIdea, getTripById, listTripsForOwner } from "@rv-trip/db";
import { defineTool } from "@/lib/mcp-tools";
import { areaResolver } from "@/lib/places";

/**
 * The proof-of-life tool set (#161 substrate): a read, a deep read, a write.
 * Each calls the SAME query/mutation its REST route calls, with `owner` and
 * `actor` from the key — so household scoping, validation, idempotent replay
 * and change_log attribution are the app's, not a second copy. The rest of
 * the grammar (`get_context`, `create_trip`, `add_save`, …) is #162's.
 */
export function registerTools(server: McpServer): void {
  defineTool(
    server,
    "list_trips",
    {
      title: "List trips",
      description: "Every trip in this household: id, title, dates, status, home base, counts. Call this first to find a trip id.",
      inputSchema: {},
    },
    async (_args, p) => listTripsForOwner(p.householdId),
  );

  defineTool(
    server,
    "get_trip",
    {
      title: "Get a trip",
      description: "The full trip: chapters → destinations (with their ideas and reservations), travel segments, dates, rig/mode defaults.",
      inputSchema: { tripId: z.string().uuid() },
    },
    async ({ tripId }, p) => {
      const trip = await getTripById(p.householdId, tripId);
      if (!trip) throw new Error("trip not found");
      return trip;
    },
  );

  defineTool(
    server,
    "add_idea",
    {
      title: "Add an idea",
      description:
        "Add an idea (something to do, eat, or stay at) to a trip, optionally under one of its destinations. Notes and a source link are kept with it. Re-running with the same clientId returns the existing idea instead of a duplicate.",
      inputSchema: {
        tripId: z.string().uuid(),
        destinationId: z.string().uuid().nullable().default(null),
        title: z.string().min(1).max(200),
        category: ideaCategory,
        notes: z.string().max(4000).optional(),
        // http(s) only: the model may have read this URL off a page it was
        // researching, and notes must never carry a javascript:/data: link.
        sourceUrl: z
          .string()
          .url()
          .refine((u) => /^https?:\/\//i.test(u), { message: "sourceUrl must be an http(s) URL" })
          .optional(),
        clientId: z.string().min(1).max(64).optional(),
      },
    },
    async ({ tripId, destinationId, title, category, notes, sourceUrl, clientId }, p) => {
      const body = [notes?.trim() || null, sourceUrl ? `Source: ${sourceUrl}` : null].filter(Boolean).join("\n\n") || null;
      return createIdea(
        p.householdId,
        { tripId, destinationId, title, category, status: "idea", place: null, rating: null, notes: body, clientId },
        { actor: p.actor, resolveArea: areaResolver() },
      );
    },
  );
}
