import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { dismissToast, undoSave, useCaptureState, type ToastTone } from "./capture";
import { Toast } from "./ui";

/**
 * The capture toast's host — one toast, read from the capture runtime, drawn
 * over whatever screen mounts this.
 *
 * Mounted in `app/(tabs)/_layout.tsx`, over every tab (a capture returns to
 * whatever tab it was opened from; Delete returns to the tab it came from).
 * #197 · #194 (vet HIGH): ALSO mounted on the Place screen, because that
 * screen is a root-Stack push OVER the tabs, so a toast drawn by the tabs
 * layout sits underneath it — Delete's offline refusal ("Deleting needs a
 * connection") is fired while the Place screen stays on top.
 */
export function CaptureToastHost() {
  const { toast } = useCaptureState();
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  const actionable = !!(toast.undoId || toast.onUndo || toast.onView);
  return (
    <View pointerEvents="box-none" style={[styles.toastLayer, { top: insets.top + 52 }]}>
      <Toast
        tone={AMBER.has(toast.tone) ? "amber" : "green"}
        glyph={TOAST_GLYPH[toast.tone]}
        title={toast.title}
        sub={toast.sub}
        onUndo={toast.undoId ? () => void undoSave(toast.undoId!) : toast.onUndo}
        onView={toast.onView}
      />
      {!actionable && <View onTouchEnd={dismissToast} style={StyleSheet.absoluteFill} />}
    </View>
  );
}

/** Amber is attention: waiting for signal, a removal, a refusal. */
const AMBER = new Set<ToastTone>(["queued", "journal-queued", "removed", "needs-signal"]);

/** The toast's lead glyph per tone. #113's journal pair: the Places tab's
 * book (▤, docs/design/113 i-book) when it landed, the capture sheet's
 * offline mark (⊘) when it waits for signal. #194's Place screen trio
 * (docs/design/197 frames 6–8): ⌫ removed, ↺ restored, ! needs signal. */
const TOAST_GLYPH: Record<ToastTone, string> = {
  saved: "✓",
  synced: "✓",
  queued: "◷",
  journal: "▤",
  "journal-queued": "⊘",
  removed: "⌫",
  restored: "↺",
  "needs-signal": "!",
};

const styles = StyleSheet.create({
  toastLayer: { position: "absolute", left: 12, right: 12 },
});
