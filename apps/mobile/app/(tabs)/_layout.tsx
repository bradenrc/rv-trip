import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import * as Linking from "expo-linking";
import { Tabs, useRouter } from "expo-router";
import { activeTrip, isRootLaunchUrl, localIsoDate } from "@rv-trip/core";
import { useCaptureState } from "../../src/capture";
import { heldTrips, hydrateInProgress, useTrips } from "../../src/store";
import { C, F, R } from "../../src/theme";
import { CaptureToastHost } from "../../src/toast-host";

/**
 * The landing rule has run this JS launch (#173 i5). Module-level, so a tab
 * switch, a remount or a return from the capture sheet never fires it again.
 */
let landed = false;

/**
 * The phone's landing rule (#172 · Q4 A): a cold start opens the trip whose
 * dates cover today — pushed in the Trips stack, so Back is the Trips list —
 * or, with none, the Places tab. A deep link or notification that opened the
 * app wins: its URL is not the root, so the rule stands down. Offline (the
 * trips load errors) it runs over the persisted in-progress bundles; with
 * neither, it stays on Trips, the default tab.
 */
function useLandingRule() {
  const router = useRouter();
  const { trips, error } = useTrips();
  const [opener, setOpener] = useState<"pending" | "root" | "link">("pending");

  useEffect(() => {
    if (landed) return;
    let live = true;
    Linking.getInitialURL()
      .then((url) => {
        if (!live) return;
        if (url && !isRootLaunchUrl(Linking.parse(url))) {
          landed = true; // a deep link or notification opened the app
          setOpener("link");
        } else setOpener("root");
      })
      .catch(() => live && setOpener("root"));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (landed || opener !== "root") return;
    const land = (list: Parameters<typeof activeTrip>[0]) => {
      landed = true;
      const active = activeTrip(list, localIsoDate());
      if (active) router.push(`/trips/${active.id}`);
      else router.navigate("/saves");
    };
    if (trips) {
      land(trips);
      return;
    }
    if (!error) return; // the list is still loading
    let live = true;
    void (async () => {
      await hydrateInProgress();
      if (!live || landed) return;
      const held = heldTrips();
      if (held.length > 0) land(held);
      else landed = true; // neither the list nor a bundle: stay on Trips
    })();
    return () => {
      live = false;
    };
  }, [opener, trips, error, router]);
}

/**
 * The bottom tabs (#111 · Q1 A; #173 i2 · #171): Trips · Places · + · You,
 * and since #186 i6 · #184 (q6 A) Map between + and You — the library pinned.
 *
 * The + (titled Capture) is not a screen anyone lands on. Its `tabPress` is
 * intercepted and opens `app/capture.tsx` — a root formSheet — from whichever
 * tab is showing, so the + sits in the same spot on every tab screen, the trip
 * screen included, and closing the sheet leaves you exactly where you were.
 *
 * The Places tab (route `saves`, a file name kept as an identifier) carries the
 * capture queue's count (amber: attention) until the queue drains. The You tab
 * is the old rig screen (Q5 A). The toast is drawn here, over every tab,
 * because a capture returns to whatever screen it was opened from.
 *
 * The kit ships no icon set (its marks are glyphs — see `CategoryTile`), so the
 * side tabs wear glyphs too.
 *
 * The landing rule (#173 i5, `useLandingRule` above) runs here, once per launch.
 */
export default function TabsLayout() {
  const router = useRouter();
  const { queue } = useCaptureState();
  useLandingRule();

  return (
    <View style={{ flex: 1, backgroundColor: C.surfaceAlt }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { backgroundColor: C.navy, borderTopColor: C.border },
          tabBarActiveTintColor: C.green,
          tabBarInactiveTintColor: C.inkFaded,
          tabBarLabelStyle: { fontSize: 10 },
        }}
      >
        <Tabs.Screen
          name="(trips)"
          options={{
            title: "Trips",
            tabBarIcon: ({ color }) => <Text style={[styles.glyph, { color }]}>▦</Text>,
          }}
        />
        <Tabs.Screen
          name="saves"
          options={{
            title: "Places",
            tabBarIcon: ({ color }) => <Text style={[styles.glyph, { color }]}>▤</Text>,
            tabBarBadge: queue.length > 0 ? queue.length : undefined,
            tabBarBadgeStyle: styles.badge,
          }}
        />
        <Tabs.Screen
          name="add"
          options={{
            title: "Capture",
            tabBarAccessibilityLabel: "Save a place, a note or a pin",
            tabBarIcon: () => (
              <View style={styles.plus}>
                <Text style={styles.plusGlyph}>+</Text>
              </View>
            ),
          }}
          listeners={{
            tabPress: (e) => {
              e.preventDefault();
              router.push("/capture");
            },
          }}
        />
        <Tabs.Screen
          name="map"
          options={{
            title: "Map",
            tabBarIcon: ({ color }) => <Text style={[styles.glyph, { color }]}>◎</Text>,
          }}
        />
        <Tabs.Screen
          name="you"
          options={{
            title: "You",
            tabBarIcon: ({ color }) => <Text style={[styles.glyph, { color }]}>◉</Text>,
          }}
        />
      </Tabs>

      <CaptureToastHost />
    </View>
  );
}

const styles = StyleSheet.create({
  glyph: { fontSize: 16 },
  // docs/design/111 `.tabs .plus`: a 38pt green-cta disc, navy +, lifted 14pt
  // above the bar.
  plus: {
    width: 38,
    height: 38,
    borderRadius: R.pill,
    backgroundColor: C.green,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -14,
    shadowColor: "#000000",
    shadowOpacity: 0.44,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  plusGlyph: { color: C.navy, fontSize: 22, fontWeight: "800", lineHeight: 24 },
  badge: {
    backgroundColor: C.warningSoft,
    color: C.warning,
    borderColor: C.warning,
    borderWidth: 1,
    fontFamily: F.mono,
    fontSize: 9,
  },
});
