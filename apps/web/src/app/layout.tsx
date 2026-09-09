import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { Nav } from "@/components/nav/Nav";

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
        <TooltipProvider>
          <Nav />
          {children}
        </TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
