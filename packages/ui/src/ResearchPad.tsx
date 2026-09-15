import type { ChangeEvent, ReactNode } from "react";
import { Link as LinkIcon } from "lucide-react";
import { Stars } from "./Stars";
import { linkLabel, noteLinks } from "./notes";

/**
 * The research pad (#82) — the ONE capture surface all three mounts share, so
 * the idea row, the shelf row and the saved place cannot drift into three
 * dialects of the same gesture.
 *
 * Capture FIRST: the note is the pad's first element and takes focus the moment
 * the row opens, because what you are doing is writing down what you just
 * found. Then the rating (no longer gated on "done" — a maybe you are
 * researching is precisely the thing worth rating before you commit), then the
 * doors out, then Google's own line, last and quietest.
 *
 * Collapsed (`expanded` false, an idea that merely has a note) it is only the
 * note box that shipped before — no rating row, no doors, no line.
 */
export function ResearchPad({
  note,
  placeholder,
  rating,
  expanded,
  drill,
  gline,
  onNoteChange,
  onNoteCommit,
  onRating,
  meta,
}: {
  /** The note's value — live when `onNoteChange` is given, the initial value
   * when it is not (see below). */
  note: string;
  placeholder: string;
  rating: number;
  expanded: boolean;
  drill?: ReactNode;
  gline?: ReactNode;
  /**
   * Present → the field is CONTROLLED and the app owns the draft, which is what
   * the two idea mounts already do (the trip's optimistic tree IS the draft).
   * Absent → the field is uncontrolled and the pad keeps the keystrokes; the
   * saved place mount takes that road, because nothing above it holds a draft
   * and a commit-on-blur field does not need one.
   */
  onNoteChange?: (v: string) => void;
  /** Commit on blur, always with the field's own value so the uncontrolled
   * mount has something to send. Absent → the note is read-only. */
  onNoteCommit?: (v: string) => void;
  /** Absent → the stars are read-only. */
  onRating?: (n: number) => void;
  /** A card-specific line that belongs BESIDE the stars rather than under them —
   * a saved place's "Heard from Dana" or the trip it was visited on. It moves
   * here while the pad is open so the footer never shows the same fact twice. */
  meta?: ReactNode;
}) {
  const readOnly = !onNoteCommit;
  const links = noteLinks(note);
  return (
    <>
      <textarea
        {...(onNoteChange
          ? { value: note, onChange: (e: ChangeEvent<HTMLTextAreaElement>) => onNoteChange(e.target.value) }
          : { defaultValue: note })}
        onBlur={(e) => onNoteCommit?.(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- the pad IS the
        // capture gesture: it opens because you are about to type into it.
        autoFocus={expanded && !readOnly}
        className="min-h-[38px] w-full resize-y rounded-rv-md border border-rv-border-soft bg-rv-surface-alt px-2.5 py-[7px] text-[13px] leading-relaxed text-rv-ink-muted"
      />
      {expanded && (
        <>
          {links.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {links.map((href) => (
                <a
                  key={href}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-[5px] rounded-rv-pill border border-rv-border bg-rv-accent-soft px-2.5 py-0.5 font-mono text-[10.5px] text-rv-accent no-underline"
                >
                  <LinkIcon className="size-3" />
                  {linkLabel(href)}
                </a>
              ))}
            </div>
          )}
          <div className="font-mono text-[10px] text-rv-ink-faded">
            {note.trim() ? "saved" : "nothing saved yet"}
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[12px] text-rv-ink-faded">my rating</span>
            <Stars value={rating} size={14} onSet={onRating} />
            {meta}
          </div>
          {drill}
          {gline}
        </>
      )}
    </>
  );
}
