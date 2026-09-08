import { TriangleAlert } from "lucide-react";
import { splitNoticeMessage } from "@rv-trip/core";

/**
 * One amber row per restriction the route avoided. Amber is reserved for a real
 * restriction — an un-routed number is not a warning, it is an unfinished
 * measurement, and takes a neutral chip instead.
 *
 * The closest shipped relative is FloatingTag: the same
 * bg-rv-warning-soft / text-rv-warning pairing, widened from a pill to a row
 * and given a border-rv-warning. The message is composed on the server; the
 * road name, the road's limit and your dimension set in font-mono like every
 * other number in the product.
 */
export function RouteNotice({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-rv-md border border-rv-warning bg-rv-warning-soft px-2.5 py-[7px] text-[12.5px] text-rv-warning">
      <TriangleAlert className="mt-[3px] size-3.5 shrink-0" aria-hidden />
      <span>
        {splitNoticeMessage(message).map((segment, i) =>
          segment.mono ? (
            <span key={i} className="font-mono">
              {segment.text}
            </span>
          ) : (
            <span key={i}>{segment.text}</span>
          ),
        )}
      </span>
    </div>
  );
}
