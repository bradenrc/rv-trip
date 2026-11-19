"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookmarkCheck, CircleCheckBig } from "lucide-react";
import { toast } from "sonner";
import type { PlaceDetails, SavedPlace, SavedPlacePatch, SavePlaceForm } from "@rv-trip/core";
import {
  applySavedPlacePatch,
  editPlacePatch,
  navigateLinksForPlace,
  placeGoogleLine,
  placeScreenMeta,
  placeSourceLine,
  placeTelUrl,
  placeTripLine,
  savePlaceFormFromSaved,
  savedPlaceToCreate,
} from "@rv-trip/core";
import { CategoryTile, DrillRow, SegmentedControl, Stars } from "@rv-trip/ui";
import { tripApi } from "@/lib/trip-api";
import { AgainBadge } from "@/components/trip/JournalLens";
import { PlaceSheet } from "./PlaceSheet";
import { SheetShell } from "./SheetShell";

/**
 * /places/[id] on the web (#197 · #196, docs/design/197 §5): one saved place
 * as a sheet, in the phone Place screen's order — what it is (the header), Go,
 * Yours, What others say, then Delete.
 *
 * It is the shipped `SheetShell` with no footer (no `onSubmit`), Edit beside ✕.
 * Two routes render it: the intercepting `@modal/(.)places/[id]` over the page
 * you were on (✕ = `router.back()`), and `places/[id]` over the library on a
 * direct load (✕ = /places, q4 A). Both hand it the save they found in the
 * owner's own list.
 *
 * Writes go through the shipped PATCH / DELETE, then `router.refresh()`, so the
 * server render stays the truth; the shelf and stars are applied locally first
 * so a click answers at once.
 */
export function PlaceView({
  save: served,
  trip,
  close,
}: {
  save: SavedPlace;
  /** The save's trip dates, for "Bellingham · Nov 11–15 →"; null → the name alone. */
  trip: { startDate: string; endDate: string } | null;
  /** "back" over the page you came from (intercepted); "/places" on a direct load. */
  close: "back" | "/places";
}) {
  const router = useRouter();
  // The server's row, with this sheet's own optimistic writes on top. A fresh
  // server render (router.refresh) replaces it.
  const [save, setSave] = useState(served);
  const [seen, setSeen] = useState(served);
  if (seen !== served) {
    setSeen(served);
    setSave(served);
  }
  const [edit, setEdit] = useState<SavePlaceForm | null>(null);
  const [saving, setSaving] = useState(false);
  const details = useDetails(save.place.googlePlaceId);

  const onClose = () => (close === "back" ? router.back() : router.push("/places"));
  const failed = () => toast.error("That change didn't save — check your connection.");

  /** Yours: the shelf and the stars, through the shipped PATCH (vet: the
   * server clears `source` on want → been, which the refresh brings back). */
  const patch = (p: SavedPlacePatch) => {
    setSave((s) => applySavedPlacePatch(s, p));
    tripApi
      .updatePlace(save.id, p)
      .then(() => router.refresh())
      .catch(() => {
        setSave(served);
        failed();
      });
  };

  /** Edit: the existing PlaceSheet in edit mode, sending core's editPlacePatch. */
  const submitEdit = () => {
    if (!edit) return;
    const p = editPlacePatch(edit);
    if (!p) return;
    setSaving(true);
    tripApi
      .updatePlace(save.id, p)
      .then(() => {
        setSave((s) => applySavedPlacePatch(s, p));
        setSaving(false);
        setEdit(null);
        router.refresh();
      })
      .catch(() => {
        setSaving(false);
        failed();
      });
  };

  /** Delete: the ⋯ menu's own delete and Undo toast (PlacesWorkspace), then the
   * sheet closes to /places. Undo re-saves the same content under a new id. */
  const remove = () => {
    setSaving(true);
    tripApi
      .deletePlace(save.id)
      .then(() => {
        toast.success(`Deleted ${save.place.name}.`, {
          action: {
            label: "Undo",
            onClick: () => {
              tripApi
                .savePlace(savedPlaceToCreate(save))
                .then(() => router.refresh())
                .catch(failed);
            },
          },
        });
        router.push("/places");
        router.refresh();
      })
      .catch(() => {
        setSaving(false);
        failed();
      });
  };

  const links = navigateLinksForPlace(save.place);
  const found = details.state === "found" ? details.place : null;
  const tripLine = placeTripLine(save, trip);
  const source = placeSourceLine(save);
  const been = save.status === "been";

  return (
    <>
      <SheetShell
        kicker={placeScreenMeta(save)}
        title={save.place.name}
        onClose={onClose}
        leading={<CategoryTile type={save.type} size="md" />}
        actions={
          <button
            type="button"
            onClick={() => setEdit(savePlaceFormFromSaved(save))}
            className="cursor-pointer border-none bg-transparent p-0 text-[13px] font-bold text-rv-accent"
          >
            Edit
          </button>
        }
      >
        {/* Go — with no point there is nothing to navigate to, so no block. */}
        {links && (
          <Block label="Go">
            <div className="grid grid-cols-3 gap-1.5">
              <GoLink href={links.google}>Google</GoLink>
              <GoLink href={links.apple}>Apple</GoLink>
              <GoLink href={links.waze}>Waze</GoLink>
            </div>
            <div className="flex gap-1.5">
              {found?.nationalPhoneNumber && (
                <GoLink sub href={placeTelUrl(found.nationalPhoneNumber)} self>
                  Call
                </GoLink>
              )}
              {found?.websiteUri && (
                <GoLink sub href={found.websiteUri}>
                  Website
                </GoLink>
              )}
              <Link href={`/map?place=${save.id}`} className={`${GO} ${GO_SUB} flex-1`}>
                On the map
              </Link>
            </div>
          </Block>
        )}

        <Block label="Yours">
          <div className="self-start">
            <SegmentedControl
              value={save.status}
              onChange={(status) => status !== save.status && patch({ status })}
              options={[
                { value: "want", label: "Want to go", Icon: BookmarkCheck },
                { value: "been", label: "Been there", Icon: CircleCheckBig },
              ]}
            />
          </div>
          {(been || save.note || tripLine || source) && (
            <div className="flex flex-col gap-1.5 rounded-rv-card border border-rv-border bg-rv-surface px-3 py-2.5">
              {been && (
                <div className="flex items-center gap-2">
                  <Stars
                    value={save.rating ?? 0}
                    size={17}
                    onSet={(n) => patch({ rating: n === 0 ? null : n })}
                  />
                  <span className="ml-auto">
                    <AgainBadge again={save.again} />
                  </span>
                </div>
              )}
              {save.note && <div className="text-[12.5px] leading-[1.4] text-rv-ink-muted">{save.note}</div>}
              {tripLine && save.tripId && (
                <Link
                  href={`/trips/${save.tripId}`}
                  className="self-start text-[11.5px] font-bold text-rv-accent no-underline"
                >
                  {tripLine}
                </Link>
              )}
              {source && <div className="font-mono text-[9.5px] text-rv-ink-faded">{source}</div>}
            </div>
          )}
        </Block>

        <Block label="What others say">
          <GoogleRow details={details} />
          <DrillRow name={save.place.name} locality={save.region} type={save.type} />
        </Block>

        <button
          type="button"
          onClick={remove}
          disabled={saving}
          className="mt-1 cursor-pointer border-none bg-transparent p-2.5 text-center text-[12.5px] font-semibold text-destructive disabled:cursor-not-allowed disabled:opacity-50"
        >
          Delete place
        </button>
      </SheetShell>

      {edit ? (
        <PlaceSheet
          form={edit}
          mode="edit"
          saving={saving}
          onChange={setEdit}
          onSubmit={submitEdit}
          onClose={() => setEdit(null)}
        />
      ) : null}
    </>
  );
}

/** A block: the mono kicker over its content (`.blk` / `.bk`). */
function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-rv-ink-faded">
        {label}
      </span>
      {children}
    </div>
  );
}

/** `.gobtn` — the navy-soft Go button; `.gobtn.sub` the outlined second row. */
const GO = "rounded-rv-card text-center text-rv-ink no-underline";
const GO_MAIN = "bg-rv-navy-soft py-2.5 text-[13px] font-bold";
const GO_SUB = "border border-rv-border-hi bg-transparent py-2 text-[11.5px] font-semibold";

function GoLink({
  href,
  sub = false,
  self = false,
  children,
}: {
  href: string;
  sub?: boolean;
  /** `tel:` hands off to the phone app; it opens no tab. */
  self?: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      {...(self ? {} : { target: "_blank", rel: "noreferrer" })}
      className={`${GO} ${sub ? `${GO_SUB} flex-1` : GO_MAIN}`}
    >
      {children}
    </a>
  );
}

type Details =
  | { state: "none" }
  | { state: "checking" }
  | { state: "found"; place: PlaceDetails };

/**
 * Google's details for the save, ONE request feeding both Call / Website (q5 A)
 * and the G line. The four states are `GoogleLine`'s: no id → none, in flight
 * → checking, an empty answer (no key, a retired id) → none.
 */
function useDetails(googlePlaceId: string | null | undefined): Details {
  const [answer, setAnswer] = useState<{ id: string; place: PlaceDetails | null } | null>(null);
  useEffect(() => {
    if (!googlePlaceId) return;
    let live = true;
    tripApi
      .placeDetails(googlePlaceId)
      .then((envelope) => {
        if (live) setAnswer({ id: googlePlaceId, place: envelope.results[0] ?? null });
      })
      .catch(() => {
        if (live) setAnswer({ id: googlePlaceId, place: null });
      });
    return () => {
      live = false;
    };
  }, [googlePlaceId]);
  if (!googlePlaceId) return { state: "none" };
  if (answer?.id !== googlePlaceId) return { state: "checking" };
  return answer.place ? { state: "found", place: answer.place } : { state: "none" };
}

/** `.gline` — "G ★ 4.6 · 1,284 reviews" and "Google Maps ↗"; "G — checking…"
 * in flight; nothing at all with no answer (states ③ and ④). */
function GoogleRow({ details }: { details: Details }) {
  if (details.state === "none") return null;
  const box =
    "flex items-center gap-2 rounded-rv-card border border-rv-border bg-rv-surface px-[11px] py-[9px]";
  if (details.state === "checking") {
    return (
      <div className={box}>
        <span className="font-mono text-[11px] text-rv-ink-faded">G — checking…</span>
      </div>
    );
  }
  const d = details.place;
  return (
    <div className={box}>
      <span className="font-mono text-[11px] text-rv-ink-faded">{placeGoogleLine(d)}</span>
      {d.googleMapsUri && (
        <a
          href={d.googleMapsUri}
          target="_blank"
          rel="noreferrer"
          className="ml-auto whitespace-nowrap text-[11.5px] font-bold text-rv-accent no-underline"
        >
          Google Maps ↗
        </a>
      )}
    </div>
  );
}
