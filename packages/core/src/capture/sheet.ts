import { reservationTypeOfGoogle } from "../domain/places";
import type { ReservationType, SavedPlace, SavedPlaceCreateInput, SavedPlaceStatus } from "../domain/types";
import type { PlaceSummary } from "../providers/index";

/**
 * The capture sheet's decisions (#111 · docs/design/111 #100), pure, so they
 * are covered where a test runner runs — `apps/mobile` has none. The sheet
 * renders what these answer; every string here is the wireframe's.
 */

/** One row group of the sheet, in the order it is drawn. */
export type CaptureRow = "places" | "note" | "pin" | "search-off";

/**
 * Which rows the one smart field shows, in order:
 *
 * - online, empty field → only "Drop a pin here" (a pin-only capture never
 *   scans past results);
 * - online, text → Google rows, then the note row, then the pin row;
 * - offline, empty → pin first, then the note, then the greyed search row;
 * - offline, text → the note first (the words stay exactly as typed), then the
 *   pin, then the greyed search row.
 */
export function captureRows(query: string, online: boolean): CaptureRow[] {
  const typed = query.trim().length > 0;
  if (online) return typed ? ["places", "note", "pin"] : ["pin"];
  return typed ? ["note", "pin", "search-off"] : ["pin", "note", "search-off"];
}

/** The field's placeholder: search is not offered without signal. */
export function captureFieldPlaceholder(online: boolean): string {
  return online ? "Place, note, or drop a pin" : "Note, or drop a pin";
}

/** "Save “chandel” as a note", or "Save as a note" before anything is typed. */
export function noteRowTitle(query: string): string {
  const q = query.trim();
  return q ? `Save “${q}” as a note` : "Save as a note";
}

/**
 * The note row's second line. Online with a resolved locality it names the
 * town — "in San José area · where you are" — from the destination's name
 * ("San José, Costa Rica") up to its first comma. Otherwise the area is not
 * guessed at.
 */
export function noteRowSubline(destinationName: string | null): string {
  if (!destinationName) return "in the area you're in";
  const town = destinationName.split(",")[0]!.trim();
  return `in ${town} area · where you are`;
}

/** 4 decimals and a true minus, as the pin rows draw it: "43.0500, −124.3300". */
export function formatCoords(lat: number, lng: number): string {
  const f = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(n).toFixed(4)}`;
  return `${f(lat)}, ${f(lng)}`;
}

/**
 * The pin row's second line: the fix and its accuracy. Offline says "GPS" —
 * that is the point of the row: a pin works with no signal.
 */
export function pinRowSubline(
  fix: { lat: number; lng: number; accuracy: number | null } | null,
  online: boolean,
): string {
  if (!fix) return "finding you…";
  const acc = fix.accuracy == null ? "" : ` · ±${Math.round(fix.accuracy)} m${online ? "" : " GPS"}`;
  return `${formatCoords(fix.lat, fix.lng)}${acc}`;
}

/** A Google row's subline, one line: "Restaurant · San José, Costa Rica". */
export function placeRowSubline(hit: Pick<PlaceSummary, "primaryTypeDisplayName" | "address">): string {
  return [hit.primaryTypeDisplayName, hit.address].filter((s): s is string => !!s).join(" · ");
}

/**
 * The Heard-from recents: the account's distinct `source` values, newest first.
 * `saves` is the library as `GET /api/places` answers it — already newest
 * first (`listSavedPlacesForOwner` orders by created_at desc).
 */
export function heardFromRecents(saves: Pick<SavedPlace, "source">[], limit = 4): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of saves) {
    const who = s.source?.trim();
    if (!who || seen.has(who.toLowerCase())) continue;
    seen.add(who.toLowerCase());
    out.push(who);
    if (out.length === limit) break;
  }
  return out;
}

// ── the bodies ─────────────────────────────────────────────────────────────

/** A capture body before the queue stamps `clientId` and `capturedAt` on it. */
export type CaptureDraft = Omit<SavedPlaceCreateInput, "clientId" | "capturedAt">;

interface Confirmed {
  status: SavedPlaceStatus;
  source: string | null;
  note: string | null;
}

const blank = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

/** A picked Google row → a `place` save. Its tile type comes from Google's. */
export function placeCaptureBody(hit: PlaceSummary, c: Confirmed): CaptureDraft {
  return {
    name: hit.name,
    googlePlaceId: hit.googlePlaceId,
    lat: hit.location?.lat ?? null,
    lng: hit.location?.lng ?? null,
    type: reservationTypeOfGoogle(hit.primaryType),
    anchor: "place",
    status: c.status,
    source: c.status === "been" ? null : blank(c.source),
    note: blank(c.note),
    capturedOffline: false,
  };
}

/**
 * Typed words → an `area` save at where the phone is. Anchored AREA even though
 * it carries the phone's point — that point is where the note was typed, not
 * where the place is (the explicit anchor beats `saveAnchorOf`). Offline, it is
 * flagged so the server can offer a place match once it lands (Q3 A).
 */
export function noteCaptureBody(
  text: string,
  at: { lat: number; lng: number } | null,
  areaLabel: string | null,
  online: boolean,
  c: Confirmed,
): CaptureDraft {
  return {
    name: text.trim(),
    lat: at?.lat ?? null,
    lng: at?.lng ?? null,
    type: "other",
    anchor: "area",
    areaLabel,
    status: c.status,
    source: c.status === "been" ? null : blank(c.source),
    note: blank(c.note),
    capturedOffline: !online,
  };
}

/** The pin sub-screen's chips → a type. Stay · Eat · Do · Other. */
export const PIN_KINDS: { label: string; type: ReservationType }[] = [
  { label: "Stay", type: "campground" },
  { label: "Eat", type: "dining" },
  { label: "Do", type: "activity" },
  { label: "Other", type: "other" },
];

/** A dropped pin, named on the sub-screen ("great BLM camp spot"). */
export function pinCaptureBody(
  name: string,
  at: { lat: number; lng: number },
  type: ReservationType,
  online: boolean,
): CaptureDraft {
  return {
    name: blank(name) ?? formatCoords(at.lat, at.lng),
    lat: at.lat,
    lng: at.lng,
    type,
    anchor: "pin",
    status: "want",
    capturedOffline: !online,
  };
}

// ── the toasts ─────────────────────────────────────────────────────────────

export interface ToastCopy {
  title: string;
  sub: string | null;
}

const statusWords: Record<SavedPlaceStatus, string> = { want: "Want to go", been: "Been there" };

/** Green, with Undo: "Saved El Chandelier" · "→ San José, Costa Rica · Want to go". */
export function savedToast(saved: Pick<SavedPlace, "place" | "destination" | "status">): ToastCopy {
  const dest = saved.destination ? `→ ${saved.destination.name} · ` : "";
  return { title: `Saved ${saved.place.name}`, sub: `${dest}${statusWords[saved.status]}` };
}

/** Amber: "Saved on this phone" · "2 waiting for signal". */
export function queuedToast(waiting: number): ToastCopy {
  return { title: "Saved on this phone", sub: `${waiting} waiting for signal` };
}

/**
 * Green, after a flush on the way back online: "Synced 2 saves" ·
 * "great BLM camp spot → Bandon, OR" — the first synced save that resolved.
 */
export function syncedToast(sent: Pick<SavedPlace, "place" | "destination">[]): ToastCopy {
  const n = sent.length;
  const anchored = sent.find((s) => s.destination);
  return {
    title: `Synced ${n} ${n === 1 ? "save" : "saves"}`,
    sub: anchored ? `${anchored.place.name} → ${anchored.destination!.name}` : null,
  };
}

/** The offline strip inside the sheet. */
export const OFFLINE_NOTICE: ToastCopy = {
  title: "Offline. Saves wait on this phone.",
  sub: "Place search comes back with signal",
};
