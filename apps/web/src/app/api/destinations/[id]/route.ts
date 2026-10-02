import { NextResponse } from "next/server";
import {
  destinationDatesOutsideTrip,
  destinationOutsideTripMessage,
  destinationPatchColumns,
  destinationPatchInput,
} from "@rv-trip/core";
import {
  SegmentDateMismatch,
  deleteDestination,
  getDestinationDateContext,
  updateDestinationFields,
} from "@rv-trip/db";
import { getActor, getOwner } from "@/lib/owner";
import { areaResolver } from "@/lib/places";

/**
 * The widened destination write: the whole place (`place` — "Change place…"), rename
 * (`placeName`), move (`chapterId`), reorder (`sortOrder`), the dates (both null is
 * "Unschedule"), and the rating/notes it always carried.
 *
 * `place` arrives NESTED and there is no `place` column, so it is flattened
 * through core's `destinationPatchColumns` before `updateDestinationFields` spreads the patch
 * into drizzle's `.set()`. That mapper also decides the one ambiguity: a body
 * carrying both `place` and `placeName` writes the place.
 *
 * 204 on success, 404 when the owner-scoped statement matched
 * no row — or when the AREA chapter of a move is not the caller's, which the
 * mutation checks separately (the destination's own scope only proves where it IS).
 *
 * 409 `destination_dates_outside_trip` is the mirror of the trip-side refusal: dates
 * the trip window does not contain would leave the destination in the database and
 * nowhere on the calendar, because `deriveDays` clamps to that window
 * (derive-days.ts). The reply carries the trip's range for the dialog to show.
 *
 * 409 `segment_date_mismatch` (#110 Q3 A — destination dates win): a date, move or
 * reorder that would put a TIMED travel segment (a flight) out of step with
 * the destination it lands at — or, for a flight home, the destination it leaves — is
 * refused and NOTHING is written; a destination is never silently re-dated. The reply
 * names the segment, the destination date the write would set (`expected`) and the
 * segment's own local date (`actual`). A FLOATING endpoint is exempt, so
 * "Unschedule" still works next to a flight (core's `segmentDateConflicts`).
 * The client needs nothing new: `tripApi.updateDestination` rejects on any non-2xx,
 * so the gesture's `persist()` rolls the optimistic change back and shows its
 * existing error toast.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = destinationPatchInput.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const owner = await getOwner();
  const patch = parsed.data;

  if (patch.arriveDate !== undefined || patch.departDate !== undefined) {
    const context = await getDestinationDateContext(owner, id);
    if (!context) return NextResponse.json({ error: "destination not found" }, { status: 404 });
    // A patch may send one date and leave the other stored, so judge the pair
    // the row will actually hold.
    const arriveDate = patch.arriveDate !== undefined ? patch.arriveDate : context.arriveDate;
    const departDate = patch.departDate !== undefined ? patch.departDate : context.departDate;
    const range = { startDate: context.tripStartDate, endDate: context.tripEndDate };
    if (destinationDatesOutsideTrip(range, { arriveDate, departDate })) {
      return NextResponse.json(
        {
          error: "destination_dates_outside_trip",
          message: destinationOutsideTripMessage(range, arriveDate!, departDate!),
          trip: range,
        },
        { status: 409 },
      );
    }
  }

  try {
    // #113 · a rated / Again destination writes through to a Been save.
    const matched = await updateDestinationFields(owner, id, destinationPatchColumns(patch), await getActor(), {
      resolveArea: areaResolver(),
    });
    if (!matched) return NextResponse.json({ error: "destination not found" }, { status: 404 });
  } catch (err) {
    if (err instanceof SegmentDateMismatch) {
      return NextResponse.json(
        { error: "segment_date_mismatch", ...err.conflict },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "chapter not found" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}

/** Delete a destination. Its reservations and ideas cascade with it, which is why the
 * client confirms with the real counts first. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const matched = await deleteDestination(await getOwner(), id);
  if (!matched) return NextResponse.json({ error: "destination not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
