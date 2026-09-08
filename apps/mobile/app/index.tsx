import { Link, Stack, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import type { TripSummary, TripStatus } from "@rv-trip/core";
import { fullRange } from "@rv-trip/core";
import { useTrips } from "../src/store";
import { API_URL } from "../src/api";
import { C, F, R } from "../src/theme";
import { Button, Card, Centered, Kicker, Muted, Pill, Stars } from "../src/ui";

const STATUS: Record<TripStatus, { label: string; color: string }> = {
  planning: { label: "Planning", color: C.ember },
  upcoming: { label: "Upcoming", color: C.info },
  complete: { label: "Traveled", color: C.green },
};

const GROUPS: { status: TripStatus; kicker: string; title: string }[] = [
  { status: "planning", kicker: "In progress", title: "Planning now" },
  { status: "upcoming", kicker: "Ahead", title: "Upcoming" },
  { status: "complete", kicker: "Been there", title: "Traveled" },
];

export default function TripsScreen() {
  const { trips, error, reload } = useTrips();
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  const refresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Link href="/rig" asChild>
              <Pressable hitSlop={8} accessibilityRole="button">
                <Text style={{ color: C.green, fontWeight: "700", fontSize: 14 }}>Rig</Text>
              </Pressable>
            </Link>
          ),
        }}
      />
      {trips === null && !error ? (
        <Centered>
          <ActivityIndicator color={C.green} />
          <Muted>Loading your trips…</Muted>
        </Centered>
      ) : error && !trips ? (
        <Centered>
          <Text style={{ color: C.ink, fontWeight: "700", fontSize: 17 }}>Couldn’t reach the hub</Text>
          <Muted>{API_URL}</Muted>
          <Muted>{error}</Muted>
          <Button onPress={() => void reload()}>Try again</Button>
        </Centered>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.green} />}
        >
          <Kicker color={C.ember}>Your trips</Kicker>
          <Text style={styles.h1}>Where to next?</Text>

          {GROUPS.map((g) => {
            const rows = (trips ?? []).filter((t) => t.status === g.status);
            if (rows.length === 0) return null;
            return (
              <View key={g.status} style={{ gap: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 8 }}>
                  <Kicker>{g.kicker}</Kicker>
                  <Text style={styles.h2}>{g.title}</Text>
                  <Text style={styles.count}>{rows.length}</Text>
                </View>
                {rows.map((t) => (
                  <TripCard key={t.id} trip={t} onPress={() => router.push(`/trips/${t.id}`)} />
                ))}
              </View>
            );
          })}
          {trips && trips.length === 0 && <Muted>No trips yet — start one on the web app.</Muted>}
        </ScrollView>
      )}
    </>
  );
}

function TripCard({ trip, onPress }: { trip: TripSummary; onPress: () => void }) {
  const s = STATUS[trip.status];
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      {({ pressed }) => (
        <Card style={{ opacity: pressed ? 0.85 : 1, gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Pill color={s.color}>{s.label}</Pill>
            {trip.rating ? <Stars value={trip.rating} size={13} /> : null}
          </View>
          <Text style={styles.cardTitle}>{trip.title}</Text>
          <Text style={styles.mono}>
            {fullRange(trip.startDate, trip.endDate)}
            {trip.homeBase ? `  ·  from ${trip.homeBase}` : ""}
          </Text>
          <View style={styles.stats}>
            <Stat n={trip.days} label="days" />
            <Stat n={trip.stops} label="stops" />
            <Stat n={trip.legs} label={trip.legs === 1 ? "leg" : "legs"} />
            <Stat n={trip.miles} label="mi" />
            {trip.open > 0 && <Stat n={trip.open} label="open" warn />}
          </View>
          {trip.note ? (
            <Text style={{ color: C.inkMuted, fontSize: 13, fontStyle: "italic" }} numberOfLines={2}>
              {trip.note}
            </Text>
          ) : null}
        </Card>
      )}
    </Pressable>
  );
}

function Stat({ n, label, warn }: { n: number; label: string; warn?: boolean }) {
  return (
    <Text style={[styles.mono, warn && { color: C.warning }]}>
      <Text style={{ fontWeight: "700", color: warn ? C.warning : C.ink }}>{n}</Text> {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 14, paddingBottom: 48 },
  h1: { color: C.ink, fontSize: 34, fontWeight: "800", letterSpacing: -0.6, marginTop: -6 },
  h2: { color: C.ink, fontSize: 19, fontWeight: "800" },
  count: { fontFamily: F.mono, color: C.inkFaded, fontSize: 12 },
  cardTitle: { color: C.ink, fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  mono: { fontFamily: F.mono, color: C.inkFaded, fontSize: 12 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 2, borderRadius: R.sm },
});
