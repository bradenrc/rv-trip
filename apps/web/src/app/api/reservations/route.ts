import { NextResponse } from "next/server";
import { z } from "zod";
import { createReservation } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

const bodySchema = z.object({
  stopId: z.string().uuid(),
  type: z.enum([
    "campground",
    "lodging",
    "dining",
    "event",
    "tour",
    "activity",
    "transport",
    "other",
  ]),
  name: z.string().min(1),
  cost: z.number().nonnegative().nullable(),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const row = await createReservation(getOwner(), parsed.data);
    return NextResponse.json(row, { status: 201 });
  } catch {
    return NextResponse.json({ error: "stop not found" }, { status: 404 });
  }
}
