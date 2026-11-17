import type { IsoDate, Trip } from "../domain/types";
import { activeTrip } from "./journal";

/**
 * The trip screen's three tabs and the rule for which one it opens on (#177 ·
 * #181 i1). Phone and web both read these, so the two clients cannot disagree
 * about the order, the labels, or the landing tab.
 */
export type TripTab = "journal" | "agenda" | "ideas";

/** Journal · Agenda · Ideas — the order both clients render. */
export const TRIP_TABS: readonly TripTab[] = ["journal", "agenda", "ideas"];

export const TRIP_TAB_LABEL: Record<TripTab, string> = {
  journal: "Journal",
  agenda: "Agenda",
  ideas: "Ideas",
};

/**
 * The tab a trip opens on. A trip whose dates cover today (`activeTrip`, the
 * landing rule's own test — the dates decide, status is not read) opens on
 * Journal; so does a trip marked complete. Everything else opens on Agenda.
 * `today` is null when the client's date is not known yet (the web with no `tz`
 * cookie): only the status rule applies then.
 */
export function defaultTripTab(
  trip: Pick<Trip, "id" | "startDate" | "endDate" | "status">,
  today: IsoDate | null,
): TripTab {
  if (today !== null && activeTrip([trip], today) !== null) return "journal";
  if (trip.status === "complete") return "journal";
  return "agenda";
}
