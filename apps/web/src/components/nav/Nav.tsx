"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Compass,
  Route,
  Bookmark,
  Map as MapIcon,
  PlusCircle,
  CircleUser,
  Sun,
  Moon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { Account } from "./Account";

type NavItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  match: (p: string) => boolean;
  /** An action, not a place: never lit, and its icon is always green. */
  action?: boolean;
};

// #173 i3 · Q1 C — the desktop row. Rig and Settings leave it and fold under
// the avatar (→ /you). The library is "Places" again; its URL never changed.
const LINKS: NavItem[] = [
  { href: "/trips", label: "Trips", Icon: Route, match: (p) => p.startsWith("/trips") },
  { href: "/places", label: "Places", Icon: Bookmark, match: (p) => p.startsWith("/places") },
  { href: "/map", label: "Map", Icon: MapIcon, match: (p) => p.startsWith("/map") },
];

// #173 i3 · Q2 B — below `md`, the phone's five. Its own list, because it now
// differs from the desktop row: Capture is the masthead's + Capture and You is
// the avatar. Capture goes to /places, the existing add-a-place flow, until
// TL2 (#176) wires web capture.
const TABS: NavItem[] = [
  { href: "/trips", label: "Trips", Icon: Route, match: (p) => p.startsWith("/trips") },
  { href: "/places", label: "Places", Icon: Bookmark, match: (p) => p.startsWith("/places") },
  { href: "/places", label: "Capture", Icon: PlusCircle, match: () => false, action: true },
  { href: "/map", label: "Map", Icon: MapIcon, match: (p) => p.startsWith("/map") },
  // You is lit on the pages that fold under it: /you lists Rig and Settings.
  { href: "/you", label: "You", Icon: CircleUser, match: (p) => ["/you", "/rig", "/settings"].some((r) => p.startsWith(r)) },
];

export function Nav() {
  const pathname = usePathname();
  const [theme, setTheme] = useTheme();
  const dark = theme === "dark";
  return (
    <>
      <nav className="dark sticky top-0 z-20 flex h-[62px] items-center justify-between gap-6 border-b border-rv-border bg-rv-surface px-4 md:px-7">
        <div className="flex items-center gap-[26px]">
          <Link href="/" className="inline-flex items-center gap-[9px]">
            <span className="inline-flex size-8 items-center justify-center rounded-rv-md bg-rv-navy">
              <Compass className="size-[19px] text-rv-green-on-dark" fill="currentColor" strokeWidth={1.5} />
            </span>
            <span className="text-[17px] font-extrabold tracking-[-0.01em] text-rv-ink">RV Trip Hub</span>
          </Link>
          {/* The desktop row. Below `md` the bottom tab bar (TABS) takes over
              and the masthead keeps only the mark. */}
          <div className="hidden items-center gap-1 md:flex">
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

        {/* #173 · Q2 B: at phone width the masthead is the mark alone. The
            theme is reachable there through You › Settings › Theme. */}
        {/* + Capture is the CTA green. The wireframe names the green-cta fill,
            but the token sweeps keep green-cta for stay text and allow navy ink
            only on the plain green fill; inside this `dark` island both tokens
            are #34d399, so it draws the same pixel (vet MED, #173). */}
        <div className="hidden items-center gap-2.5 md:inline-flex">
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

          <Link href="/places" className="inline-flex items-center whitespace-nowrap rounded-rv-md bg-rv-green px-[13px] py-[7px] text-[13.5px] font-bold text-rv-navy">
            + Capture
          </Link>

          <Account />
        </div>
      </nav>

      {/* The phone's five (TABS), below `md` only: a thumb-reachable edge
          bar beats two taps behind a sheet, and hidden navigation gets used
          less. Same literal `dark` island as the masthead, so the chrome does
          not flip with the theme. `fixed` means it overlays the page — the
          clearance for that is PageShell's phone bottom padding. */}
      <nav className="dark fixed inset-x-0 bottom-0 z-20 flex border-t border-rv-border bg-rv-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {TABS.map(({ href, label, Icon, match, action }) => {
          const active = match(pathname);
          return (
            <Link
              key={label}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex h-[56px] flex-1 flex-col items-center justify-center gap-[3px] text-[10px] font-semibold transition-colors ${
                active ? "text-rv-ink" : "text-rv-ink-faded"
              }`}
            >
              {/* No pill behind the active tab: at five across it is wider than
                  its label and reads as a button, not a state. The green icon
                  carries it — the pairing the masthead link already uses. */}
              {/* Capture's icon is always green: it is the action. */}
              <Icon className={`size-[19px] ${action || active ? "text-rv-green" : "text-rv-ink-subtle"}`} />
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
