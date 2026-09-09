import { NextResponse } from "next/server";
import { stopDatesOutsideTrip, stopOutsideTripMessage, stopPatchInput } from "@rv-trip/core";
import { deleteStop, getStopDateContext, updateStopFields } from "@rv-trip/db";
import { getOwner } from "@/lib/owner";

/**
 * The widened stop write: rename (`placeName`), move (`legId`), reorder
 * (`sortOrder`), the dates (both null is "Unschedule"), and the rating/notes it
 * always carried. 204 on success, 404 when the owner-scoped statement matched
 * no row — or when the DESTINATION leg of a move is not the caller's, which the
 * mutation checks separately (the stop's own scope only proves where it IS).
 *
 * 409 `stop_dates_outside_trip` is the mirror of the trip-side refusal: dates
 * the trip window does not contain would leave the stop in the database and
 * nowhere on the calendar, because `deriveDays` clamps to that window
 * (derive-days.ts). The reply carries the trip's range for the dialog to show.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = stopPatchInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const owner = await getOwner();
  const patch = parsed.data;

  if (patch.arriveDate !== undefined || patch.departDate !== undefined) {
    const context = await getStopDateContext(owner, id);
    if (!context) return NextResponse.json({ error: "stop not found" }, { status: 404 });
    // A patch may send one date and leave the other stored, so judge the pair
    // the row will actually hold.
    const arriveDate = patch.arriveDate !== undefined ? patch.arriveDate : context.arriveDate;
    const departDate = patch.departDate !== undefined ? patch.departDate : context.departDate;
    const range = { startDate: context.tripStartDate, endDate: context.tripEndDate };
    if (stopDatesOutsideTrip(range, { arriveDate, departDate })) {
      return NextResponse.json(
        {
          error: "stop_dates_outside_trip",
          message: stopOutsideTripMessage(range, arriveDate!, departDate!),
          trip: range,
        },
        { status: 409 },
      );
    }
  }

  try {
    const matched = await updateStopFields(owner, id, patch);
    if (!matched) return NextResponse.json({ error: "stop not found" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "leg not found" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}

/** Delete a stop. Its reservations and ideas cascade with it, which is why the
 * client confirms with the real counts first. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const matched = await deleteStop(await getOwner(), id);
  if (!matched) return NextResponse.json({ error: "stop not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
