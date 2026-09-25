import { Stack } from "expo-router";
import { STACK_OPTIONS } from "../../../src/nav";

/**
 * The Trips tab's own stack (#111 Q1 A) — the three screens the root Stack used
 * to register, unchanged and at the same URLs: a `(group)` segment adds nothing
 * to the path, so `/` is still the trips list and `/trips/[id]` still a trip.
 * Nesting them here is what keeps the tab bar (and its +) under a trip.
 */
export default function TripsStack() {
  return (
    <Stack screenOptions={STACK_OPTIONS}>
      <Stack.Screen name="index" options={{ title: "RV Trip Hub" }} />
      <Stack.Screen name="trips/[id]/index" options={{ title: "Trip" }} />
      <Stack.Screen name="trips/[id]/stops/[stopId]" options={{ title: "Stop" }} />
    </Stack>
  );
}
