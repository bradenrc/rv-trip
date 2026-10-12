import { NextResponse } from "next/server";
import { z } from "zod";
import { createApiKey } from "@rv-trip/db";
import { getActor, getOwner } from "@/lib/owner";

/**
 * Settings → API keys → Mint (#162 · Q8 A). Mints an MCP key for THIS
 * household (`getOwner()`), acting as the member who pressed the button
 * (`getActor()` — `createApiKey` refuses a non-member). The plaintext key is
 * in this response and nowhere else: only its sha256 is stored, which is why
 * the card shows it once.
 *
 * The answer carries what the card draws and nothing more — never the hash
 * (vet MED: `createApiKey`'s row is the full table row). Session auth only:
 * the proxy answers a bearer that is not a Clerk session with a 401, so a key
 * can never mint a key.
 */
const mintInput = z.object({ name: z.string().trim().min(1).max(100) });

export async function POST(req: Request) {
  const parsed = mintInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const { key, row } = await createApiKey(await getOwner(), { name: parsed.data.name, createdBy: await getActor() });
    return NextResponse.json({ key, id: row.id, name: row.name, prefix: row.prefix }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "not a member of this household" }, { status: 403 });
  }
}
