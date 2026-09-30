import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ClerkProvider, Show, useAuth } from "@clerk/expo";
import { CLERK_KEY, clerkEnabled, secureStoreTokenCache, setTokenGetter } from "../src/auth";
import { useCaptureRuntime } from "../src/capture";
import { STACK_OPTIONS } from "../src/nav";
import { C } from "../src/theme";
import SignInScreen from "./sign-in";

/**
 * The navigator, lifted into one component so the app is mounted from exactly
 * one place — bare when there is no Clerk key, and behind
 * `<Show when="signed-in">` when there is.
 *
 * #111 (Q1 A): the root Stack holds the bottom tabs — Trips · + · Saves, whose
 * Trips tab nests the stack that used to live here, so `/` and `/trips/[id]`
 * keep their URLs — plus the two screens that sit ABOVE the tabs: the capture
 * sheet, opened by the center + from any tab as a formSheet, and the rig.
 */
function Shell() {
  // The capture queue's flush needs the session token, so it runs in here.
  useCaptureRuntime();
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={STACK_OPTIONS}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="capture"
          options={{
            presentation: "formSheet",
            headerShown: false,
            sheetGrabberVisible: true,
            sheetAllowedDetents: [0.92],
            contentStyle: { backgroundColor: C.surface },
          }}
        />
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
 * Key present → the navigator is unreachable without a session:
 * `<Show when="signed-out">` renders the sign-in screen and nothing else — the
 * same core-3 gate the web uses (`apps/web/src/components/nav/Account.tsx`, #147).
 */
export default function RootLayout() {
  if (!clerkEnabled) return <Shell />;
  return (
    <ClerkProvider publishableKey={CLERK_KEY} tokenCache={secureStoreTokenCache}>
      <TokenBridge />
      <Show when="signed-in">
        <Shell />
      </Show>
      <Show when="signed-out">
        <SignInScreen />
      </Show>
    </ClerkProvider>
  );
}
