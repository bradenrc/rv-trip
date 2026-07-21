"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, Route, Bookmark, Map as MapIcon, Caravan, ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const LINKS: { href: string; label: string; Icon: LucideIcon; match: (p: string) => boolean }[] = [
  { href: "/", label: "Trips", Icon: Route, match: (p) => p === "/" || p.startsWith("/trips") },
  { href: "/places", label: "Places", Icon: Bookmark, match: (p) => p.startsWith("/places") },
  { href: "/map", label: "Map", Icon: MapIcon, match: (p) => p.startsWith("/map") },
  { href: "/rig", label: "Rig", Icon: Caravan, match: (p) => p.startsWith("/rig") },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="sticky top-0 z-20 flex h-[62px] items-center justify-between gap-6 border-b border-rv-border bg-rv-surface px-7">
      <div className="flex items-center gap-[26px]">
        <Link href="/" className="inline-flex items-center gap-[9px]">
          <span className="inline-flex size-8 items-center justify-center rounded-rv-md bg-rv-navy">
            <Compass className="size-[19px] text-rv-green-on-dark" fill="currentColor" strokeWidth={1.5} />
          </span>
          <span className="text-[17px] font-extrabold tracking-[-0.01em] text-rv-navy">RV Trip Hub</span>
        </Link>
        <div className="flex items-center gap-1">
          {LINKS.map(({ href, label, Icon, match }) => {
            const active = match(pathname);
            return (
              <Link
                key={href}
                href={href}
                className={`inline-flex items-center gap-[7px] rounded-rv-md px-[13px] py-2 text-[14px] font-semibold transition-colors ${
                  active ? "bg-rv-navy-soft text-rv-navy" : "bg-transparent text-rv-ink-faded"
                }`}
              >
                <Icon className={`size-[17px] ${active ? "text-rv-green" : "text-rv-ink-subtle"}`} />
                {label}
              </Link>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        title="Account — Braden"
        className="inline-flex cursor-pointer items-center gap-2 rounded-rv-pill border border-rv-border bg-transparent py-1 pl-[5px] pr-2.5"
      >
        <span className="inline-flex size-[30px] items-center justify-center rounded-full border-2 border-rv-surface bg-rv-green font-mono text-[12px] font-bold text-white">
          B
        </span>
        <span className="text-[13px] font-semibold text-rv-ink-muted">Braden</span>
        <ChevronDown className="size-[13px] text-rv-ink-subtle" />
      </button>
    </nav>
  );
}
