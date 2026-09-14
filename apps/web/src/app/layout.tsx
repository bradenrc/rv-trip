import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { Nav } from "@/components/nav/Nav";
import { PrefSync } from "@/components/nav/PrefSync";
import { ClerkProvider } from "@clerk/nextjs";
import { clerkEnabled } from "@/lib/owner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RV Trip Hub",
  description: "A personal trip hub for long RV / road trips.",
};

/**
 * `viewportFit: "cover"` is the whole point of this export: without it the page
 * stops at the safe area and `env(safe-area-inset-bottom)` resolves to 0, so
 * the phone tab bar (Nav.tsx:88) and PageShell's bottom gutter both lose the
 * home-indicator clearance they are written against.
 *
 * `themeColor` is the same static navy as app/manifest.ts — `#020617`, the
 * value of `--rv-navy` in packages/ui/styles/entry.css:85 / :131. The chrome is
 * a literal `dark` island in both halves, so this never has to follow the theme.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#020617", // --rv-navy, verbatim
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `dark` is the literal default in the HTML, so it is true with JS off and
    // on a first-ever visit. suppressHydrationWarning: the inline script below
    // removes the class before hydration for anyone who chose light, and React
    // would otherwise report a recoverable className mismatch on <html>.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-rv-surface-alt">
        {/* First child of <body>: runs before any content paints. It only ever
            REMOVES the class — dark is never a JS conclusion. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('rv-theme')==='light')" +
              "document.documentElement.classList.remove('dark')}catch{}",
          }}
        />
        {/* Clerk only when configured (#26): keyless local dev and the mc
            pipeline's walks run as the dev-user stub with no provider at all. */}
        <MaybeClerk>
          {/* Adopts the account's saved preferences after first paint. Inside
              MaybeClerk so its GET carries whatever session there is; renders
              nothing, and never touches the no-FOUC answer above. */}
          <PrefSync />
          <TooltipProvider>
            <Nav />
            {children}
          </TooltipProvider>
          <Toaster />
        </MaybeClerk>
      </body>
    </html>
  );
}

function MaybeClerk({ children }: { children: React.ReactNode }) {
  return clerkEnabled() ? <ClerkProvider>{children}</ClerkProvider> : <>{children}</>;
}
