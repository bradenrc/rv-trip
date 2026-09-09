"use client";

import { useRef, useState } from "react";

/**
 * Single-line click-to-edit text — the light weight of the editing grammar
 * (trip title, leg title, stop place name).
 *
 * It lives here and not in `@rv-trip/ui`: the design system is deliberately
 * display-only (it is mirrored out to `ds-bundle/` for previews and ships no
 * interactive primitive), so the one editable primitive belongs beside the
 * app's other interactive ones.
 *
 * `className` carries the typography of the text it replaces and is applied to
 * BOTH renders, so entering and leaving the edit shifts nothing.
 *
 * Enter saves · Esc cancels · blur saves. All three go through exactly one
 * path: Enter and Esc blur the input, and `onBlur` is the only place that
 * commits, so a save can never fire twice. Esc sets a flag first — Esc also
 * fires blur, and without the flag the cancel would immediately re-save.
 *
 * `autoEdit` opens it already editing, which is how the row menus' "Rename"
 * and a just-created leg/stop reach it — the menu item focuses THIS edit rather
 * than opening a second rename surface. The caller flips it by remounting (a
 * changed `key`), so there is no second source of truth for "am I editing"; it
 * hears the edit end through `onEditEnd`.
 */
export function InlineText({
  value,
  onSave,
  label,
  className = "",
  placeholder,
  autoEdit = false,
  onEditEnd,
}: {
  /** the current text — the source of truth, including after a rollback */
  value: string;
  /** called only when the text actually changed and is non-blank */
  onSave: (next: string) => void;
  /** accessible name for the click target ("Rename trip") */
  label: string;
  /** typography of the text being replaced; applied to both renders */
  className?: string;
  placeholder?: string;
  /** mount straight into the edit (the "Rename" menu item, a new row) */
  autoEdit?: boolean;
  /** the edit ended — saved or cancelled. Lets the caller drop `autoEdit`. */
  onEditEnd?: () => void;
}) {
  const [editing, setEditing] = useState(autoEdit);
  // Seeded from `value` when the edit opens, never synced to it after: while the
  // field is open what you are typing is the truth, and the closed render reads
  // `value` directly, so a change from anywhere else (a rollback, a reload)
  // shows up the moment the edit ends.
  const [draft, setDraft] = useState(value);
  const cancelling = useRef(false);

  const commit = () => {
    setEditing(false);
    onEditEnd?.();
    const next = draft.trim();
    // Blank is a cancel, not a delete: the grammar has no nameless trip or leg.
    if (next === "" || next === value) {
      setDraft(value);
      return;
    }
    onSave(next);
  };

  if (!editing) {
    return (
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          cancelling.current = false;
          setDraft(value);
          setEditing(true);
        }}
        className={`cursor-text border-0 border-b border-dashed border-rv-border-hi bg-transparent p-0 pb-px text-left text-inherit ${className}`}
      >
        {value}
      </button>
    );
  }

  return (
    <input
      autoFocus
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelling.current = true;
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      onBlur={() => {
        if (cancelling.current) {
          cancelling.current = false;
          setEditing(false);
          setDraft(value);
          onEditEnd?.();
          return;
        }
        commit();
      }}
      className={`w-full border-0 border-b border-dashed border-rv-border-hi bg-transparent p-0 pb-px text-inherit outline-none ${className}`}
    />
  );
}
