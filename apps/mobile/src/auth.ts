import * as SecureStore from "expo-secure-store";
import { bearerAuthHeader } from "@rv-trip/core/api-client";

/**
 * The phone's half of the auth gate (issue #44 / #33) — the mobile mirror of
 * `apps/web/src/lib/owner.ts`.
 *
 * One env var decides everything. With `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` set
 * the root layout mounts `<ClerkProvider>` and nothing but the sign-in screen
 * renders until there is a session; without it the provider never mounts, no
 * `Authorization` header is ever built, and the app runs against the seeded
 * `dev-user` exactly as it did before — which is what keeps the mc-dev walk
 * worktrees and CI key-free.
 *
 * Read at module load (not per call, as the web does): Expo inlines
 * `EXPO_PUBLIC_*` at bundle time, so it cannot change while the app is running.
 */
export const CLERK_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
export const clerkEnabled = Boolean(CLERK_KEY);

/**
 * Clerk's token cache, on the Keychain.
 *
 * Clerk keeps the session token in memory by default; `expo-secure-store`
 * encrypts it at rest so the sign-in screen is seen once per device instead of
 * once per launch. Every call is defensive: a Keychain read can fail (a restored
 * backup, a changed passcode), and the right answer to that is "no session",
 * never a crash at startup. A value that cannot be read is deleted so the next
 * sign-in starts clean.
 */
export const secureStoreTokenCache = {
  async getToken(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      await SecureStore.deleteItemAsync(key).catch(() => {});
      return null;
    }
  },
  async saveToken(key: string, token: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(key, token);
    } catch {
      // Not fatal: the session still works this launch, just not the next one.
    }
  },
  async clearToken(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Already gone, or the Keychain is unreadable — either way, nothing to do.
    }
  },
};

/**
 * The seam between React and the API client.
 *
 * `src/api.ts` builds the client as a module singleton, before any React tree
 * exists, so it cannot call `useAuth()` — hooks do not cross that boundary.
 * Instead the provider hands its `getToken` in through this box (see the
 * `TokenBridge` effect in `app/_layout.tsx`), and the client reads the box on
 * every request. Keyless it stays `null` forever, which is the whole reason
 * `getAuthHeader` resolves `null` in a build with no key.
 */
export const tokenGetter: { current: (() => Promise<string | null>) | null } = { current: null };

export function setTokenGetter(get: (() => Promise<string | null>) | null): void {
  tokenGetter.current = get;
}

/** `Bearer <jwt>` when there is a session, `null` otherwise. */
export const getAuthHeader = bearerAuthHeader(() => tokenGetter.current?.() ?? null);
