import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { navigateLinks, navigationCaption, type RouteDrive } from "@rv-trip/core";
import { C, F, R } from "./theme";

/**
 * #180 · q1 A / q2 A (docs/design/181 frame 2) — Navigate on a phone drive,
 * the twin of the web's components/trip/NavigateLinks.tsx.
 *
 * Every drive gets three plain links to the arriving destination — Google,
 * Apple, Waze, destination only (core's `navigateLinks`). A rig-on trip also
 * keeps the dashed "RV route" line: the Google handoff (`drive.navUrl`, ✓ only
 * when the corridor check passed), HERE WeGo (`drive.navWegoUrl`), and the
 * caption from core's `navigationCaption`.
 *
 * The phone bundle carries no NavMap (GET /api/trips/[id] routes without
 * `{ nav: true }` — the check is billable and opt-in per caller), so every
 * phone drive is "plain" today: no ✓, and the amber caption, exactly as the
 * shipped phone caption read. The branch is kept so the day the bundle gains
 * the check, the phone paints it with no change here.
 *
 * Every pill is a plain URL, so Navigate still works offline on the cached
 * bundle. The Google pill's copy lives here and never in the trip screen —
 * mobile-map.test.ts keeps the map surfaces free of any Google fallback.
 */
export function NavigateLinks({
  drive,
  rigOn,
  toName,
  fromName,
}: {
  drive: RouteDrive;
  rigOn: boolean;
  /** The arriving destination's name — "→ Newport, OR". */
  toName: string;
  /** The leaving destination's name; the label keeps the part before the
   * first comma ("Astoria, OR" → "Astoria"). */
  fromName: string;
}) {
  const links = navigateLinks(drive.navTo);
  const caption = navigationCaption(drive);
  const checked = drive.navVerdict === "checked";
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.row}>
        <Text style={[styles.to, { marginRight: "auto" }]}>→ {toName}</Text>
        <Pill label="Google" url={links.google} />
        <Pill label="Apple" url={links.apple} />
        <Pill label="Waze" url={links.waze} />
      </View>
      {rigOn && (
        <View style={styles.rvline}>
          <View style={styles.row}>
            <Text style={[styles.label, { marginRight: "auto" }]}>
              RV route · from {fromName.split(",")[0]}
            </Text>
            <Pill label="Google" url={drive.navUrl} ok={checked} />
            <Pill label="HERE WeGo" url={drive.navWegoUrl} />
          </View>
          <Text style={[styles.caption, { color: caption.tone === "checked" ? C.green : C.warning }]}>
            {caption.text}
          </Text>
        </View>
      )}
    </View>
  );
}

function Pill({ label, url, ok = false }: { label: string; url: string; ok?: boolean }) {
  return (
    <Pressable
      onPress={() => void Linking.openURL(url)}
      accessibilityRole="link"
      accessibilityLabel={ok ? `${label}, checked against the RV corridor` : label}
      style={styles.pill}
    >
      <Text style={styles.pillText}>
        {label}
        {ok && <Text style={{ color: C.green }}> ✓</Text>}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" },
  to: { fontFamily: F.mono, fontSize: 11, color: C.inkFaded },
  rvline: {
    gap: 4,
    borderTopWidth: 1,
    borderStyle: "dashed",
    borderTopColor: C.borderHi,
    paddingTop: 6,
  },
  label: {
    fontFamily: F.mono,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: C.inkFaded,
  },
  caption: { fontSize: 11.5 },
  pill: {
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: R.pill,
    backgroundColor: C.navySoft,
  },
  pillText: { color: C.ink, fontSize: 12, fontWeight: "700" },
});
