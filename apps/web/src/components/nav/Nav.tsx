"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, Route, Bookmark, Map as MapIcon, Caravan, Sun, Moon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { Account } from "./Account";

const LINKS: { href: string; label: string; Icon: LucideIcon; match: (p: string) => boolean }[] = [
  { href: "/", label: "Trips", Icon: Route, match: (p) => p === "/" || p.startsWith("/trips") },
  { href: "/places", label: "Places", Icon: Bookmark, match: (p) => p.startsWith("/places") },
  { href: "/map", label: "Map", Icon: MapIcon, match: (p) => p.startsWith("/map") },
  { href: "/rig", label: "Rig", Icon: Caravan, match: (p) => p.startsWith("/rig") },
];

export function Nav() {
  const pathname = usePathname();
  const [theme, setTheme] = useTheme();
  const dark = theme === "dark";
  return (
    <nav className="dark sticky top-0 z-20 flex h-[62px] items-center justify-between gap-6 border-b border-rv-border bg-rv-surface px-7">
      <div className="flex items-center gap-[26px]">
        <Link href="/" className="inline-flex items-center gap-[9px]">
          <span className="inline-flex size-8 items-center justify-center rounded-rv-md bg-rv-navy">
            <Compass className="size-[19px] text-rv-green-on-dark" fill="currentColor" strokeWidth={1.5} />
          </span>
          <span className="text-[17px] font-extrabold tracking-[-0.01em] text-rv-ink">RV Trip Hub</span>
        </Link>
        <div className="flex items-center gap-1">
          {LINKS.map(({ href, label, Icon, match }) => {
            const active = match(pathname);
            return (
              <Link
                key={href}
                href={href}
                className={`inline-flex items-center gap-[7px] rounded-rv-md px-[13px] py-2 text-[14px] font-semibold transition-colors ${
                  active ? "bg-rv-navy-soft text-rv-ink" : "bg-transparent text-rv-ink-faded"
                }`}
              >
                <Icon className={`size-[17px] ${active ? "text-rv-green" : "text-rv-ink-subtle"}`} />
                {label}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() =>
            setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark")
          }
          title={dark ? "Switch to light theme" : "Switch to dark theme"}
          aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
          className="inline-flex size-8 cursor-pointer items-center justify-center rounded-rv-md border border-rv-border bg-transparent text-rv-ink-faded hover:text-rv-ink"
        >
          {/* No React state decides the glyph: CSS picks it off <html>, so it is
              right pre-hydration, right with JS off, and immune to the `dark`
              island this button sits inside (issue #19 F1). */}
          <Sun className="hidden size-[17px] theme-dark:block" />
          <Moon className="block size-[17px] theme-dark:hidden" />
        </button>

        <Account />
      </div>
    </nav>
  );
}
