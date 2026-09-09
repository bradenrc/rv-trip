import { NextResponse, type NextRequest } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";
import { clerkEnabled } from "@/lib/owner";

/**
 * Auth boundary (issue #26). With Clerk configured, every request needs a
 * session: pages redirect to sign-in, API routes answer 401 JSON (the contract
 * for the mobile/API clients, which send the session JWT as
 * `Authorization: Bearer` — clerkMiddleware verifies header and cookie alike).
 * Without keys this is a pass-through and the app runs as the dev-user stub.
 *
 * Next 16: this file is `proxy.ts`, not `middleware.ts`, and always runs on
 * the Node runtime.
 */
const withClerk = clerkMiddleware(async (auth, req) => {
  const { isAuthenticated } = await auth();
  if (isAuthenticated) return;
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await auth.protect(); // document request → redirect to sign-in
});

export default function proxy(req: NextRequest, event: Parameters<typeof withClerk>[1]) {
  return clerkEnabled() ? withClerk(req, event) : NextResponse.next();
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
    // Clerk's frontend-API proxy path
    "/__clerk/(.*)",
  ],
};
