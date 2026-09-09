"use client";

import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { CircleDot, MapPin, Pencil, TriangleAlert, X } from "lucide-react";
import {
  PICKER_DEBOUNCE_MS,
  moveHighlight,
  pickerView,
  type PickedPlace,
  type PickerRow,
  type PlacesEnvelope,
} from "@rv-trip/core";
import { cn } from "@/lib/utils";
import { tripApi } from "@/lib/trip-api";

/**
 * The place picker — docs/design/41 §4, Variant C.
 *
 * Controlled: one value in, one value out. It takes no trip, no leg and no
 * stop, which is the whole point — #21 (home base), #22 (add a stop) and #24
 * (add an idea) mount it unchanged without #41 building any of their sheets.
 *
 * The free-text escape row is pinned to the bottom of EVERY state that shows a
 * list (results, no matches, degraded), so there is no empty state to design
 * and saving is never blocked: a coordless row is a legal row
 * (`saved_places.lat` is nullable) and Locate exists to fix it.
 *
 * The state machine itself — which rows exist, what the status line reads, what
 * a chosen row emits, where the highlight starts — is
 * `@rv-trip/core`'s `place-picker.ts`, where it is unit-tested. This file is the
 * JSX over it plus the debounce timer.
 */

export type { PickedPlace };

/** The envelope every failure collapses to, so there is one shape to render. */
const OFFLINE: PlacesEnvelope = { results: [], degraded: true, reason: "upstream_error" };

export function PlacePicker({
  value,
  onChange,
  placeholder,
  near,
}: {
  value: PickedPlace | null;
  onChange: (p: PickedPlace | null) => void;
  placeholder?: string;
  /** Search bias — a map centre today, a trip's home base later. */
  near?: { lat: number; lng: number } | null;
}) {
  const [query, setQuery] = useState("");
  // Both of these are stamped with the query they belong to, so "is this answer
  // still the answer" is a comparison rather than a second effect resetting
  // state — the reason nothing here calls setState during a render or an effect
  // body (react-hooks/set-state-in-effect).
  const [answer, setAnswer] = useState<{ q: string; envelope: PlacesEnvelope } | null>(null);
  const [cursor, setCursor] = useState<{ q: string; index: number } | null>(null);
  const listId = useId();

  // `near` is an object prop, so its identity changes every render; the two
  // numbers are what the request actually depends on.
  const nearLat = near?.lat ?? null;
  const nearLng = near?.lng ?? null;
  const picked = value !== null;

  const q = query.trim();
  const searching = !picked && q !== "";
  // A stale envelope is no envelope: every keystroke drops back to the waiting
  // state (§4 state 2) rather than showing the list from two letters ago.
  const envelope = searching && answer?.q === q ? answer.envelope : null;

  useEffect(() => {
    if (!searching) return;
    let live = true;
    const timer = setTimeout(() => {
      const bias = nearLat !== null && nearLng !== null ? { lat: nearLat, lng: nearLng } : null;
      tripApi
        .searchPlaces(q, bias)
        .then((env) => {
          if (live) setAnswer({ q, envelope: env });
        })
        .catch(() => {
          if (live) setAnswer({ q, envelope: OFFLINE });
        });
    }, PICKER_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, searching, nearLat, nearLng]);

  const view = pickerView({
    value,
    query,
    envelope,
    pending: searching && envelope === null,
    placeholder,
    // Undefined hands the decision back to initialHighlight — a fresh answer
    // starts where the design says it starts.
    highlight: cursor?.q === q ? cursor.index : undefined,
  });

  const reset = () => {
    setQuery("");
    setAnswer(null);
    setCursor(null);
  };

  const commit = (p: PickedPlace) => {
    onChange(p);
    reset();
  };

  const clear = () => {
    onChange(null);
    reset();
  };

  // ── states 6 + 7 · picked ────────────────────────────────────────────────
  if (view.state === "picked") {
    const mapped = view.mapped;
    return (
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-rv-md border px-3 py-[9px]",
          mapped ? "border-rv-green bg-rv-green-soft" : "border-rv-border-hi bg-rv-surface",
        )}
      >
        <span
          className={cn(
            "inline-flex size-[26px] flex-none items-center justify-center rounded-rv-sm",
            mapped ? "bg-rv-navy text-rv-green" : "bg-rv-surface-alt text-rv-ink-faded",
          )}
        >
          {mapped ? <MapPin className="size-[14px]" /> : <Pencil className="size-[14px]" />}
        </span>
        <span className="min-w-0">
          <span
            className={cn(
              "block truncate text-[13.5px] font-bold",
              mapped ? "text-rv-green-ink" : "text-rv-ink",
            )}
          >
            {view.picked.name}
          </span>
          <span
            className={cn(
              "block truncate font-mono text-[10.5px]",
              mapped ? "text-rv-green" : "text-rv-ink-faded",
            )}
          >
            {view.coordLabel}
          </span>
        </span>
        <button
          type="button"
          onClick={clear}
          aria-label="Clear the picked place"
          className="ml-auto inline-flex cursor-pointer border-none bg-transparent p-0 text-rv-ink-faded"
        >
          <X className="size-[14px]" />
        </button>
      </div>
    );
  }

  // ── states 1-5 · the box, and whatever it opened ─────────────────────────
  const list = view.state === "list" ? view : null;
  const rows: PickerRow[] = list?.rows ?? [];
  const open = list !== null;
  const status = view.state === "typing" ? view.status : list?.status;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setQuery("");
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setCursor({
        q,
        index: moveHighlight(list.highlight, rows.length, e.key === "ArrowDown" ? 1 : -1),
      });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      // Nothing highlighted (the degraded list) still has an answer: the escape
      // row, which is always last. Enter never dead-ends.
      const row = rows[list.highlight] ?? rows[rows.length - 1];
      if (row) commit(row.picked);
    }
  };

  return (
    <div className="relative">
      <div
        className={cn(
          "flex items-center gap-[9px] border bg-rv-surface px-3 py-[9px] text-[13.5px]",
          "focus-within:border-rv-green",
          open ? "rounded-t-rv-md border-rv-green" : "rounded-rv-md border-rv-border-hi",
        )}
      >
        <CircleDot className="size-[13px] flex-none text-rv-green" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={view.state === "idle" ? view.placeholder : undefined}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && list.highlight >= 0 ? `${listId}-${list.highlight}` : undefined
          }
          // §4 draws the placeholder in the subtle ink; that token is scoped to
          // non-text glyphs by nightfall-tokens.test.ts (the #19 vet's HIGH), so
          // the placeholder takes the faded ink — the documented meta-text role
          // and the nearest legal token. See docs/design/41/dev-notes.md.
          className="min-w-0 flex-1 border-none bg-transparent p-0 text-rv-ink outline-none placeholder:text-rv-ink-faded"
        />
        {status ? (
          <span className="ml-auto flex-none font-mono text-[10px] text-rv-ink-faded">
            {status}
          </span>
        ) : null}
      </div>

      {open ? (
        <div className="absolute inset-x-0 top-full z-10">
          <div
            id={listId}
            role="listbox"
            className={cn(
              "border border-t-0 border-rv-border bg-rv-surface shadow-rv-xl",
              !list.degradedMessage && "rounded-b-rv-md",
            )}
          >
            {rows.map((row, i) => (
              <div
                key={row.kind === "escape" ? "escape" : (row.picked.googlePlaceId ?? row.name)}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === list.highlight}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setCursor({ q, index: i })}
                onClick={() => commit(row.picked)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 border-b border-rv-border-soft px-3 py-[9px] last:border-b-0",
                  row.kind === "escape" && "bg-rv-navy",
                  i === list.highlight && "bg-rv-navy-soft",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-[26px] flex-none items-center justify-center rounded-rv-sm",
                    row.kind === "escape"
                      ? "bg-rv-surface-alt text-rv-ink-faded"
                      : "bg-rv-green-soft text-rv-green",
                  )}
                >
                  {row.kind === "escape" ? (
                    <Pencil className="size-[14px]" />
                  ) : (
                    <MapPin className="size-[14px]" />
                  )}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block truncate text-[13px]",
                      row.kind === "escape"
                        ? "font-semibold text-rv-ink-muted"
                        : "font-[650] text-rv-ink",
                    )}
                  >
                    {row.name}
                  </span>
                  {row.detail ? (
                    <span className="block truncate font-mono text-[10.5px] text-rv-ink-faded">
                      {row.detail}
                    </span>
                  ) : null}
                </span>
                {row.rating !== null ? (
                  <span className="ml-auto flex-none whitespace-nowrap font-mono text-[10.5px] text-rv-ember">
                    ★ {row.rating}
                  </span>
                ) : null}
              </div>
            ))}
          </div>

          {list.degradedMessage ? (
            <div className="flex items-start gap-[9px] rounded-b-rv-md border border-t-0 border-rv-warning bg-rv-warning-soft px-3 py-[9px] text-[12.5px] text-rv-warning">
              <TriangleAlert className="mt-[2px] size-[13px] flex-none" />
              <span>{list.degradedMessage}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
