import { metersToFeetInches, kilogramsToPounds, type RigProfileInput } from "../domain/rig";
import type { RouteNotice } from "./index";

/**
 * Notice copy is composed on the SERVER so it lives in one place and the client
 * never string-builds a clearance. The limit and your dimension always sit in
 * the same sentence, so the *why* needs no explaining.
 */

export type NoticeKind = RouteNotice["kind"];

/** 11′6″ — always with the inches, even at zero. */
export function formatFeetInches(meters: number): string {
  const { feet, inches } = metersToFeetInches(meters);
  return `${feet}′${inches}″`;
}

/** 14,500 lb */
export function formatPounds(kg: number): string {
  return `${kilogramsToPounds(kg).toLocaleString("en-US")} lb`;
}

/**
 * Best-effort mapping from a vendor notice code to the dimension it is about.
 * Deliberately loose: an unrecognised code still renders as an amber row rather
 * than being dropped, because a restriction we cannot classify is still a
 * restriction.
 */
export function noticeKind(code: string, cause?: string | null): NoticeKind {
  const haystack = `${code} ${cause ?? ""}`.toLowerCase();
  if (haystack.includes("hazard") || haystack.includes("hazmat")) return "propane";
  if (haystack.includes("height")) return "height";
  if (haystack.includes("width")) return "width";
  if (haystack.includes("length")) return "length";
  if (haystack.includes("weight")) return "weight";
  return "other";
}

export function composeNoticeMessage(input: {
  kind: NoticeKind;
  roadName: string | null;
  limitMeters: number | null;
  /**
   * The road's weight limit, in kilograms. A weight limit is not a distance, so
   * it never occupies `RouteNotice.limitMeters` — it reaches the driver here,
   * in the same sentence as their own weight, which is the only form in which
   * the number means anything.
   */
  limitKilograms?: number | null;
  rig: RigProfileInput | null;
}): string {
  const { kind, roadName, limitMeters, limitKilograms, rig } = input;
  const road = roadName ?? "this road";

  if (kind === "propane") {
    return `Propane on board — the ${road} tunnel is bypassed.`;
  }

  const yours = rigDimension(kind, rig);
  // `limitMeters` is a distance, so it can only describe a dimensional limit;
  // a weight limit arrives in kilograms and is set in pounds instead.
  const dimensional = kind === "height" || kind === "width" || kind === "length";
  const limit =
    dimensional && limitMeters != null
      ? formatFeetInches(limitMeters)
      : kind === "weight" && limitKilograms != null
        ? formatPounds(limitKilograms)
        : null;

  if (kind === "height" && limit && yours) {
    return `Avoids the ${road} tunnel — ${limit} clearance, your rig is ${yours}.`;
  }
  if (limit && yours) {
    return `Avoids ${road} — ${limit} ${kind} limit, your rig is ${yours}.`;
  }
  if (yours) {
    return `Avoids ${road} — a ${kind} limit your rig does not clear at ${yours}.`;
  }
  return roadName
    ? `Avoids ${roadName} — a restriction there affects your rig.`
    : "A restriction on this route affects your rig.";
}

function rigDimension(kind: NoticeKind, rig: RigProfileInput | null): string | null {
  if (!rig) return null;
  switch (kind) {
    case "height":
      return formatFeetInches(rig.heightMeters);
    case "width":
      return formatFeetInches(rig.widthMeters);
    case "length":
      return formatFeetInches(rig.lengthMeters);
    case "weight":
      return formatPounds(rig.grossWeightKg);
    default:
      return null;
  }
}

/**
 * Split a composed message into plain and mono runs. The road name, the road's
 * limit and your dimension are numbers and identifiers, so they set in
 * font-mono like every other number in the product — but the message is one
 * server-composed sentence, so the split happens here (once, tested) rather
 * than the client string-building a clearance.
 */
export interface NoticeSegment {
  text: string;
  mono: boolean;
}

const MONO_TOKEN = /([A-Z]{1,3}-\d{1,4}|\d+′\d+″|[\d,]+ lb)/g;

export function splitNoticeMessage(message: string): NoticeSegment[] {
  const segments: NoticeSegment[] = [];
  let last = 0;
  for (const match of message.matchAll(MONO_TOKEN)) {
    const start = match.index!;
    if (start > last) segments.push({ text: message.slice(last, start), mono: false });
    segments.push({ text: match[0], mono: true });
    last = start + match[0].length;
  }
  if (last < message.length) segments.push({ text: message.slice(last), mono: false });
  return segments;
}
