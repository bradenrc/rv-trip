import type { Reservation, TransportKind, TravelMode } from "./types";

/**
 * #155 · Q4 A — what a transport booking IS, as every reader needs it.
 *
 * `transport_kind` is nullable on purpose: a row written before #155 has no
 * kind, and it must keep behaving exactly as it did — a booking on a flown hop
 * is a flight, on a ferry hop a ferry. So the EFFECTIVE kind is the stored one
 * when it is set, and the hop's mode when it is not.
 */
export function effectiveTransportKind(
  r: Pick<Reservation, "transportKind">,
  mode: TravelMode,
): TransportKind {
  return r.transportKind ?? (mode === "ferry" ? "ferry" : "flight");
}

/**
 * Only flights and ferries move a hop's clock: they are what a layover sits
 * between and what "door to door" measures. A shuttle, a train or a car is
 * logistics around the hop — it never prints "layover at LIR" and never
 * stretches door to door.
 */
export function countsTowardClock(kind: TransportKind): boolean {
  return kind === "flight" || kind === "ferry";
}

/** The same rule for a booking whose kind may be unset — null counts, because
 * null reads as the hop's own (fly or ferry) mode. */
export function movesClock(r: { transportKind?: TransportKind | null }): boolean {
  return r.transportKind == null || countsTowardClock(r.transportKind);
}

/** The order the hop chip and Logistics name kinds in. */
export const TRANSPORT_KIND_ORDER: readonly TransportKind[] = ["flight", "ferry", "shuttle", "train", "car"];

const PLURAL: Record<TransportKind, string> = {
  flight: "flights",
  ferry: "ferries",
  shuttle: "shuttles",
  train: "trains",
  car: "cars",
};

/** "1 flight" · "2 flights" · "2 ferries". */
export function countTransportKind(kind: TransportKind, n: number): string {
  return `${n} ${n === 1 ? kind : PLURAL[kind]}`;
}
