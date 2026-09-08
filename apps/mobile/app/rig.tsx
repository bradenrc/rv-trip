import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import type { RigProfile } from "@rv-trip/core";
import { formatFeetInches, formatPounds } from "@rv-trip/core";
import { api } from "../src/api";
import { C, F } from "../src/theme";
import { Card, Centered, Kicker, Muted } from "../src/ui";

/** Read-only in v1 — the rig is set up once, on the web. */
export default function RigScreen() {
  const [rig, setRig] = useState<RigProfile | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    api.rig
      .get()
      .then(setRig)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (rig === undefined) {
    return <Centered>{error ? <Muted>{error}</Muted> : <ActivityIndicator color={C.green} />}</Centered>;
  }
  if (rig === null) {
    return (
      <Centered>
        <Text style={{ color: C.ink, fontWeight: "700", fontSize: 17 }}>No rig yet</Text>
        <Muted>Set up your rig on the web app. Until then every drive is a straight-line estimate.</Muted>
      </Centered>
    );
  }

  const rows: [string, string][] = [
    ["Type", rig.type === "motorhome" ? "Motorhome" : "Trailer + tow"],
    ["Height", formatFeetInches(rig.heightMeters)],
    ["Width", formatFeetInches(rig.widthMeters)],
    ["Length", formatFeetInches(rig.lengthMeters)],
    ["Gross weight", formatPounds(rig.grossWeightKg)],
    ["Propane on board", rig.propaneOnBoard ? "Yes" : "No"],
  ];

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Kicker color={C.accent}>Routing input</Kicker>
      <Text style={styles.h1}>{rig.name}</Text>
      <Text style={{ color: C.inkMuted, fontSize: 14, lineHeight: 20 }}>
        Every drive on every trip is routed under these numbers — low bridges, weight limits and
        propane-restricted tunnels are avoided, not discovered.
      </Text>
      <Card style={{ gap: 0, padding: 0 }}>
        {rows.map(([k, v], i) => (
          <View key={k} style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: C.borderSoft }]}>
            <Text style={styles.k}>{k}</Text>
            <Text style={styles.v}>{v}</Text>
          </View>
        ))}
      </Card>
      <Muted>Edit the rig on the web — this screen is read-only in v1.</Muted>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 12 },
  h1: { color: C.ink, fontSize: 30, fontWeight: "800", letterSpacing: -0.6, marginTop: -6 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12 },
  k: { color: C.inkFaded, fontSize: 14 },
  v: { fontFamily: F.mono, color: C.ink, fontSize: 14, fontWeight: "600" },
});
