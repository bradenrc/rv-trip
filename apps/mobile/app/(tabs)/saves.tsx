import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { queuedToast } from "@rv-trip/core";
import { useCaptureState } from "../../src/capture";
import { C, F } from "../../src/theme";
import { Kicker, Toast } from "../../src/ui";

/**
 * The Saves tab — a PLACEHOLDER in #111 i1. The grouped shelves (region
 * headers, destinations, the Want / Been split, the suggestion strip) are i2.
 *
 * What it does carry now is the queue: while captures are waiting for signal
 * the tab says so, the same amber line the capture toast used.
 */
export default function SavesTab() {
  const { queue } = useCaptureState();
  const waiting = queuedToast(queue.length);
  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <View style={styles.nav}>
        <Kicker color={C.green}>Heard about · been to</Kicker>
        <Text style={styles.title}>Saves</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {queue.length > 0 && <Toast tone="amber" glyph="◷" title={waiting.title} sub={waiting.sub} />}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.surfaceAlt },
  nav: {
    backgroundColor: C.navy,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  title: { color: C.ink, fontSize: 19, fontWeight: "800", letterSpacing: -0.4, fontFamily: F.sans },
  content: { padding: 12, gap: 8 },
});
