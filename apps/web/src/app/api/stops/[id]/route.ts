import { NextResponse } from "next/server";
import {
  stopDatesOutsideTrip,
  stopOutsideTripMessage,
  stopPatchColumns,
  stopPatchInput,
} from "@rv-trip/core";
import {
  SegmentDateMismatch,
  deleteStop,
  getStopDateContext,
  updateStopFields,
} from "@rv-trip/db";
import { getActor, getOwner } from "@/lib/owner";

/**
 * The widened stop write: the whole place (`place` — "Change place…"), rename
 * (`placeName`), move (`legId`), reorder (`sortOrder`), the dates (both null is
 * "Unschedule"), and the rating/notes it always carried.
 *
 * `place` arrives NESTED and there is no `place` column, so it is flattened
 * through core's `stopPatchColumns` before `updateStopFields` spreads the patch
 * into drizzle's `.set()`. That mapper also decides the one ambiguity: a body
 * carrying both `place` and `placeName` writes the place.
 *
 * 204 on success, 404 when the owner-scoped statement matched
 * no row — or when the DESTINATION leg of a move is not the caller's, which the
 * mutation checks separately (the stop's own scope only proves where it IS).
 *
 * 409 `stop_dates_outside_trip` is the mirror of the trip-side refusal: dates
 * the trip window does not contain would leave the stop in the database and
 * nowhere on the calendar, because `deriveDays` clamps to that window
 * (derive-days.ts). The reply carries the trip's range for the dialog to show.
 *
 * 409 `segment_date_mismatch` (#110 Q3 A — stop dates win): a date, move or
 * reorder that would put a TIMED travel segment (a flight) out of step with
 * the stop it lands at — or, for a flight home, the stop it leaves — is
 * refused and NOTHING is written; a stop is never silently re-dated. The reply
 * names the segment, the stop date the write would set (`expected`) and the
 * segment's own local date (`actual`). A FLOATING endpoint is exempt, so
 * "Unschedule" still works next to a flight (core's `segmentDateConflicts`).
 * The client needs nothing new: `tripApi.updateStop` rejects on any non-2xx,
 * so the gesture's `persist()` rolls the optimistic change back and shows its
 * existing error toast.
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
    const matched = await updateStopFields(owner, id, stopPatchColumns(patch), await getActor());
    if (!matched) return NextResponse.json({ error: "stop not found" }, { status: 404 });
  } catch (err) {
    if (err instanceof SegmentDateMismatch) {
      return NextResponse.json(
        { error: "segment_date_mismatch", ...err.conflict },
        { status: 409 },
      );
    }
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
