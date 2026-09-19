"use client";

import { useEffect, useState } from "react";
import type { PlaceDetails } from "@rv-trip/core";
import { tripApi } from "@/lib/trip-api";

/**
 * The quiet Google line (#82 §7) — LAST in the research pad, and the only thing
 * in it that costs a request.
 *
 * It is an APP component, not a design-system one, because nothing in
 * packages/ui touches the network: the DS card takes it as a `gline` slot the
 * same way it takes the place picker. It fetches our own route (never Google
 * directly — the key never leaves the server), on expand, once per open.
 *
 * Four states, and three of them render NOTHING:
 *   ① located + a fresh cached row → `G ★ 4.6 · 812 · website · call · map`
 *   ② located, nothing cached yet  → `G — checking…`
 *   ③ never located (no google_place_id) → no line, and no request made
 *   ④ no GOOGLE_API_KEY (local, CI, every walk) → the degraded envelope, and
 *      the line renders exactly as ③ does: nothing. Not an error, not an empty
 *      shell, not a spinner that never resolves.
 *
 * Google's rating is font-mono and faded on purpose: it can never be mistaken
 * for the Sky <Stars> row above it, which is OURS.
 */
export function GoogleLine({ googlePlaceId }: { googlePlaceId?: string | null }) {
  /**
   * ONE piece of state, keyed by the id it answers for — so "in flight" is
   * derived (`answer.id !== googlePlaceId`) rather than a second flag that can
   * disagree with the first, and nothing is ever set synchronously inside the
   * effect.
   */
  const [answer, setAnswer] = useState<{ id: string; place: PlaceDetails | null } | null>(null);

  useEffect(() => {
    // State ③ — nothing to ask about, so nothing is asked.
    if (!googlePlaceId) return;
    let live = true;
    void tripApi.placeDetails(googlePlaceId).then((envelope) => {
      if (live) setAnswer({ id: googlePlaceId, place: envelope.results[0] ?? null });
    });
    return () => {
      live = false;
    };
  }, [googlePlaceId]);

  if (!googlePlaceId) return null;

  if (answer?.id !== googlePlaceId) {
    // ② in flight.
    return (
      <div className="mt-[13px] flex flex-wrap items-center gap-2 border-t border-rv-border pt-2.5 font-mono text-[11px] text-rv-ink-faded">
        <span className="font-bold text-rv-ink-faded">G</span>
        <span className="text-rv-ink-faded">— checking…</span>
      </div>
    );
  }

  // The answer is in and empty — a retired id, or state ④'s degraded envelope.
  // The line leaves the card entirely rather than rendering a hollow shell.
  const place = answer.place;
  if (!place) return null;

  return (
    <div className="mt-[13px] flex flex-wrap items-center gap-2 border-t border-rv-border pt-2.5 font-mono text-[11px] text-rv-ink-faded">
      <span className="font-bold text-rv-ink-faded">G</span>
      {place.rating != null && <span>★ {place.rating}</span>}
      {place.userRatingCount != null && (
        <>
          <span>·</span>
          <span>{place.userRatingCount.toLocaleString()}</span>
        </>
      )}
      {place.websiteUri && (
        <>
          <span>·</span>
          <a
            href={place.websiteUri}
            target="_blank"
            rel="noreferrer"
            className="text-rv-accent no-underline"
          >
            website
          </a>
        </>
      )}
      {place.nationalPhoneNumber && (
        <>
          <span>·</span>
          <a
            href={`tel:${telHref(place.nationalPhoneNumber)}`}
            className="text-rv-accent no-underline"
          >
            call
          </a>
        </>
      )}
      {place.googleMapsUri && (
        <>
          <span>·</span>
          <a
            href={place.googleMapsUri}
            target="_blank"
            rel="noreferrer"
            className="text-rv-accent no-underline"
          >
            map
          </a>
        </>
      )}
    </div>
  );
}

/** Google's national format is for reading; `tel:` wants the digits. */
function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? digits : `+1${digits}`;
}
