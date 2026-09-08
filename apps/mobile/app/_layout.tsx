import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { C, F } from "../src/theme";

export default function RootLayout() {
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
