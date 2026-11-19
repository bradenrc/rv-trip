import { Pressable, StyleSheet, Text, View } from "react-native";
import { suggestionStrip, type SavedPlace } from "@rv-trip/core";
import { patchSave } from "./store";
import { C, F, R } from "./theme";

/**
 * The Q3 A strip: "Did you mean El Chandelier?". Tap upgrades; Dismiss clears.
 *
 * Lifted out of the Places tab (`app/(tabs)/saves.tsx`) by #197 · #193 so the
 * Place screen can show the same strip in Go's slot when a note has nothing to
 * navigate to (docs/design/197 frame 4) — one component, not a second.
 */
export function Suggestion({ save }: { save: SavedPlace }) {
  const copy = suggestionStrip(save.suggestedPlace!);
  return (
    <Pressable
      onPress={() => void patchSave(save.id, { upgradeToSuggested: true }).catch(() => {})}
      accessibilityRole="button"
      accessibilityLabel={copy.title}
      style={styles.suggest}
    >
      <Text style={styles.suggestGlyph}>✦</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.suggestTitle} numberOfLines={1}>
          {copy.title}
        </Text>
        {copy.sub ? (
          <Text style={styles.suggestSub} numberOfLines={1}>
            {copy.sub}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={() => void patchSave(save.id, { suggestedPlace: null }).catch(() => {})}
        accessibilityRole="button"
        hitSlop={10}
      >
        <Text style={styles.dismiss}>{copy.dismiss}</Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // .suggest
  suggest: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.info,
    backgroundColor: C.infoSoft,
    borderRadius: R.card,
    paddingVertical: 7,
    paddingHorizontal: 9,
  },
  // rv-info-ink resolves to rv-info in the night palette the phone mirrors.
  suggestGlyph: { color: C.info, fontSize: 13 },
  suggestTitle: { fontSize: 12, fontWeight: "700", color: C.ink },
  suggestSub: { fontSize: 10.5, color: C.inkMuted },
  dismiss: { fontFamily: F.mono, fontSize: 10, color: C.inkFaded },
});
