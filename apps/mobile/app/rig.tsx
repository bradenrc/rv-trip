import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { RigProfile, UserPrefs } from "@rv-trip/core";
import { formatFeetInches, formatPounds, homeBaseRowValue, householdHomeBasePatch } from "@rv-trip/core";
import { useClerk, useUser } from "@clerk/clerk-expo";
import { api } from "../src/api";
import { clerkEnabled } from "../src/auth";
import { Label, failed } from "../src/hops";
import { PlaceSearchField, type Picked } from "../src/itinerary";
import { C, F, R } from "../src/theme";
import { Card, Centered, Kicker, Muted } from "../src/ui";

/** Read-only in v1 — the rig is set up once, on the web. The household home
 * base (#142 · Q5 A) is the one thing set here. */
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
    // #142 — a fly-only household still reaches the Home base row.
    return (
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <AccountCard />
        <HomeBaseRow />
        <View style={{ marginTop: 28, alignItems: "center", gap: 6 }}>
          <Text style={{ color: C.ink, fontWeight: "700", fontSize: 17 }}>No rig yet</Text>
          <Muted>Set up your rig on the web app. Until then every drive is a straight-line estimate.</Muted>
        </View>
      </ScrollView>
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
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <AccountCard />
      <HomeBaseRow />
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

/**
 * #142 · Q5 A — "🏠 Home base": the HOUSEHOLD home base, one row card straight
 * under AccountCard. Tapping it opens the shared place search (no anchor); a
 * pick writes `PUT /api/prefs { homeBasePlace }`. A trip can still override it
 * in its own settings.
 */
function HomeBaseRow() {
  const [prefs, setPrefs] = useState<UserPrefs | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    api.prefs
      .get()
      .then((p) => live && setPrefs(p))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const pick = async (p: Picked) => {
    if (saving) return;
    setSaving(true);
    try {
      setPrefs(await api.prefs.put(householdHomeBasePatch(p)));
      setOpen(false);
    } catch {
      failed("That home base");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card style={{ gap: 0, padding: 0 }}>
        <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" style={styles.row}>
          <Text style={styles.k}>🏠 Home base</Text>
          <Text style={styles.v}>{prefs === undefined ? "" : homeBaseRowValue(prefs)}</Text>
        </Pressable>
      </Card>
      {open && (
        <View style={{ gap: 6 }}>
          <Label>Home base</Label>
          <PlaceSearchField anchor={null} onPick={(p) => void pick(p)} />
        </View>
      )}
      <Text style={styles.note}>Where your trips start and end. A trip can override it in Edit ▸ Starts from.</Text>
    </>
  );
}

/**
 * "You", above your rig (issue #44, item 2).
 *
 * Branches on a module constant, exactly as the web's `Account.tsx` does, so
 * the hook order never changes within a build: keyless renders the stub and
 * calls no Clerk hook at all.
 */
function AccountCard() {
  if (!clerkEnabled) return <DevAccountCard />;
  return <ClerkAccountCard />;
}

function ClerkAccountCard() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const name = user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "";
  return (
    <Card style={{ gap: 5 }}>
      <Kicker>Account</Kicker>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={styles.avatar}>
          <Text style={styles.avatarMark}>{(name[0] ?? "?").toUpperCase()}</Text>
        </View>
        <View style={{ gap: 1 }}>
          <Text style={styles.accountName}>{name}</Text>
          <Text style={styles.stubNote}>signed in on this device</Text>
        </View>
        <Pressable
          onPress={() => void signOut()}
          accessibilityRole="button"
          style={[styles.ghost, { marginLeft: "auto" }]}
        >
          <Text style={styles.ghostText}>Sign out</Text>
        </Pressable>
      </View>
    </Card>
  );
}

/** No keys in this build — the web's dashed stub, so a keyless build is never
 * mistaken for a signed-in one (`apps/web/src/components/nav/Account.tsx`). */
function DevAccountCard() {
  return (
    <Card style={{ gap: 5 }}>
      <Kicker>Account</Kicker>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={styles.stubPill}>
          <View style={[styles.avatar, { width: 26, height: 26 }]}>
            <Text style={[styles.avatarMark, { fontSize: 11 }]}>D</Text>
          </View>
          <Text style={styles.stubName}>dev-user</Text>
        </View>
      </View>
      <Text style={styles.stubNote}>
        No Clerk keys in this build — running as the seeded dev-user. No sign-out, because there
        is no session.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 12 },
  h1: { color: C.ink, fontSize: 30, fontWeight: "800", letterSpacing: -0.6, marginTop: -6 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12 },
  k: { color: C.inkFaded, fontSize: 14 },
  v: { fontFamily: F.mono, color: C.ink, fontSize: 14, fontWeight: "600" },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: R.pill,
    backgroundColor: C.green,
    borderWidth: 2,
    borderColor: C.borderHi,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarMark: { fontFamily: F.mono, fontSize: 13, fontWeight: "700", color: C.navy },
  accountName: { color: C.ink, fontSize: 14.5, fontWeight: "700" },
  stubPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: C.border,
    borderRadius: R.pill,
    paddingLeft: 5,
    paddingRight: 10,
    paddingVertical: 4,
  },
  stubName: { color: C.inkMuted, fontSize: 12, fontWeight: "700" },
  stubNote: { fontFamily: F.mono, fontSize: 10, color: C.inkFaded, lineHeight: 15 },
  note: { fontFamily: F.mono, fontSize: 10.5, color: C.inkFaded, lineHeight: 15, marginTop: -3 },
  ghost: {
    borderWidth: 1,
    borderColor: C.borderHi,
    borderRadius: R.md,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  ghostText: { color: C.ink, fontSize: 12.5, fontWeight: "700" },
});
