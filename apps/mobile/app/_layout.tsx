import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ClerkProvider, SignedIn, SignedOut, useAuth } from "@clerk/clerk-expo";
import { CLERK_KEY, clerkEnabled, secureStoreTokenCache, setTokenGetter } from "../src/auth";
import { C, F } from "../src/theme";
import SignInScreen from "./sign-in";

/**
 * Today's navigator and its four registered screens, lifted into one component
 * so the app is mounted from exactly one place — bare when there is no Clerk
 * key, and behind `<SignedIn>` when there is.
 */
function Shell() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: C.navy },
          headerTintColor: C.ink,
          headerTitleStyle: { fontWeight: "800", fontFamily: F.sans },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: C.surfaceAlt },
          headerBackButtonDisplayMode: "minimal",
        }}
      >
        <Stack.Screen name="index" options={{ title: "RV Trip Hub" }} />
        <Stack.Screen name="trips/[id]/index" options={{ title: "Trip" }} />
        <Stack.Screen name="trips/[id]/stops/[stopId]" options={{ title: "Stop" }} />
        <Stack.Screen name="rig" options={{ title: "Your rig" }} />
      </Stack>
    </>
  );
}

/**
 * Hands the session's `getToken` to `src/api.ts`'s seam.
 *
 * The API client is a module singleton built before this tree exists, so it
 * cannot call `useAuth()` itself (see the note in `src/auth.ts`). This is the
 * one place that hook runs, and it runs inside the provider.
 */
function TokenBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    setTokenGetter(() => getToken());
    return () => setTokenGetter(null);
  }, [getToken]);
  return null;
}

/**
 * The gate (issue #44, item 2).
 *
 * No key → `Shell` alone: no provider, no `Authorization` header, the seeded
 * `dev-user`, exactly as the app ran before. That is the same promise
 * `clerkEnabled()` keeps on the web (`apps/web/src/lib/owner.ts`), and it is
 * what keeps the mc-dev walk worktrees and CI key-free.
 *
 * Key present → the navigator is unreachable without a session: `<SignedOut>`
 * renders the sign-in screen and nothing else.
 */
export default function RootLayout() {
  if (!clerkEnabled) return <Shell />;
  return (
    <ClerkProvider publishableKey={CLERK_KEY} tokenCache={secureStoreTokenCache}>
      <TokenBridge />
      <SignedIn>
        <Shell />
      </SignedIn>
      <SignedOut>
        <SignInScreen />
      </SignedOut>
    </ClerkProvider>
  );
}
