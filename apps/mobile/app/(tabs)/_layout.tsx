import { StyleSheet, Text, View } from "react-native";
import { Tabs, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { dismissToast, undoSave, useCaptureState } from "../../src/capture";
import { C, F, R } from "../../src/theme";
import { Toast } from "../../src/ui";

/**
 * The bottom tabs (#111 · Q1 A): Trips · + · Saves.
 *
 * The center + is not a screen anyone lands on. Its `tabPress` is intercepted
 * and opens `app/capture.tsx` — a root formSheet — from whichever tab is
 * showing, so the + sits in the same spot on every tab screen, the trip screen
 * included, and closing the sheet leaves you exactly where you were.
 *
 * The Saves tab carries the capture queue's count (amber: attention) until the
 * queue drains. The toast is drawn here, over every tab, because a capture
 * returns to whatever screen it was opened from.
 *
 * The kit ships no icon set (its marks are glyphs — see `CategoryTile`), so the
 * two side tabs wear glyphs too.
 */
export default function TabsLayout() {
  const router = useRouter();
  const { queue, toast } = useCaptureState();
  const insets = useSafeAreaInsets();

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
          name="add"
          options={{
            title: "Save",
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
          name="saves"
          options={{
            title: "Saves",
            tabBarIcon: ({ color }) => <Text style={[styles.glyph, { color }]}>▤</Text>,
            tabBarBadge: queue.length > 0 ? queue.length : undefined,
            tabBarBadgeStyle: styles.badge,
          }}
        />
      </Tabs>

      {toast && (
        <View pointerEvents="box-none" style={[styles.toastLayer, { top: insets.top + 52 }]}>
          <Toast
            tone={toast.tone === "queued" ? "amber" : "green"}
            glyph={toast.tone === "queued" ? "◷" : "✓"}
            title={toast.title}
            sub={toast.sub}
            onUndo={toast.undoId ? () => void undoSave(toast.undoId!) : undefined}
          />
          {!toast.undoId && <View onTouchEnd={dismissToast} style={StyleSheet.absoluteFill} />}
        </View>
      )}
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
  toastLayer: { position: "absolute", left: 12, right: 12 },
});
