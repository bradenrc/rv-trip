/**
 * The one page gutter (#34 / #45 item 1).
 *
 * Six routes used to carry a verbatim copy of `mx-auto w-full max-w-[1120px]
 * px-7 pb-[72px] pt-9`, so the phone case had to be fixed six times. It is
 * declared once here, mobile-first against the app's single `md` breakpoint:
 * the bare classes are the phone and `md:` restores the shipped desktop values.
 *
 * The 88px of phone bottom padding is the tab bar's clearance: `Nav`'s bottom
 * bar is `fixed`, so it OVERLAYS the page — 56px of bar plus the 32px the
 * design already breathes, plus whatever inset the OS reports. At `md` there is
 * no bar and the shipped 72px comes back.
 *
 * The calc is spelled with underscores because that is how a Tailwind arbitrary
 * value encodes the whitespace `calc()` requires around `+`; written
 * `calc(88px+env(…))` the declaration is unparseable and silently dropped, and
 * the page scrolls under the bar — the exact failure the 88px exists to prevent.
 */
export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-[1120px] px-4 pt-6 pb-[calc(88px_+_env(safe-area-inset-bottom))] md:px-7 md:pt-9 md:pb-[72px]">
      {children}
    </main>
  );
}
