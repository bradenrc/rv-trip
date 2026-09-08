import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { RouteDrive, RouteRow as RouteRowModel } from "@rv-trip/core";
import { dayKindColor, fullRange, routeModel, routeSummary, timelineModel } from "@rv-trip/core";
import { useBundle } from "../../../src/store";
import { C, F, R } from "../../../src/theme";
import { Button, Card, Centered, EstimateChip, FloatingTag, Kicker, Muted, Stars } from "../../../src/ui";

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { bundle, error, reload } = useBundle(id);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  // The same two models the web planner renders — from @rv-trip/core/planner.
  const timeline = useMemo(() => (bundle ? timelineModel(bundle.trip) : null), [bundle]);
  const legs = useMemo(
    () => (bundle ? routeModel(bundle.trip, bundle.routes, bundle.rigHash) : []),
    [bundle],
  );
  const summary = useMemo(
    () => (bundle ? routeSummary(bundle.trip, bundle.routes, bundle.rigHash) : null),
    [bundle],
  );

  if (!bundle) {
    return (
      <Centered>
        {error ? (
          <>
            <Text style={{ color: C.ink, fontWeight: "700", fontSize: 17 }}>Couldn’t load this trip</Text>
            <Muted>{error}</Muted>
            <Button onPress={() => void reload()}>Try again</Button>
          </>
        ) : (
          <ActivityIndicator color={C.green} />
        )}
      </Centered>
    );
  }

  const { trip } = bundle;
  const refresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  return (
    <>
      <Stack.Screen options={{ title: trip.title }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.green} />}
      >
        {/* Masthead */}
        <Kicker color={C.ember}>Trip planner</Kicker>
        <Text style={styles.h1}>{trip.title}</Text>
        <Text style={styles.mono}>
          {fullRange(trip.startDate, trip.endDate)} · {timeline!.rhythm.length} days
          {trip.homeBase ? ` · from ${trip.homeBase}` : ""}
        </Text>
        <Text style={[styles.mono, { color: C.warning }]}>{timeline!.openLabel}</Text>

        {/* Day strip — the rhythm of the trip, one cell per day */}
        <Card style={{ padding: 10, gap: 6 }}>
          <Kicker>Rhythm</Kicker>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: "row", gap: 2 }}>
              {timeline!.rhythm.map((cell, i) => {
                const label = timeline!.ruler[i]!;
                return (
                  <View key={i} style={{ alignItems: "center", gap: 3, width: 16 }}>
                    <View
                      style={{
                        width: 16,
                        height: 18,
                        borderRadius: 3,
                        backgroundColor: dayKindColor(cell.kind),
                        borderWidth: cell.kind === "drive" ? 1 : 0,
                        borderColor: C.borderHi,
                      }}
                    />
                    <Text style={{ fontFamily: F.mono, fontSize: 8, color: label.weekStart ? C.ink : C.inkSubtle }}>
                      {label.letter}
                    </Text>
                  </View>
                );
              })}
            </View>
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Legend color={C.green} label="Stay" />
            <Legend color={C.navy} label="Drive" outlined />
            <Legend color={C.navySoft} label="Open" />
          </View>
        </Card>

        {/* Route — legs → stops, drives between */}
        {legs.map((leg) => (
          <View key={leg.id} style={{ gap: 8, marginTop: 6 }}>
            <Kicker>{leg.kicker}</Kicker>
            <Text style={styles.h2}>{leg.name}</Text>
            {leg.rows.map((row) => (
              <View key={row.stop.id} style={{ gap: 8 }}>
                <StopRow row={row} onPress={() => router.push(`/trips/${trip.id}/stops/${row.stop.id}`)} />
                {row.drive && <Drive drive={row.drive} />}
              </View>
            ))}
            {leg.outboundDrive && (
              <View style={{ gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginLeft: 12 }}>
                  <Kicker>{leg.outboundSeam}</Kicker>
                  <View style={{ flex: 1, height: 1, backgroundColor: C.borderSoft }} />
                </View>
                <Drive drive={leg.outboundDrive} />
              </View>
            )}
          </View>
        ))}

        {/* Floating stops that have no leg row yet are already in the route list; the rail: */}
        <Card style={{ gap: 10, marginTop: 8 }}>
          <Kicker>On the road</Kicker>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
            <Text style={styles.hero}>{summary!.driveMiles || "—"}</Text>
            {summary!.driveMiles > 0 && <Text style={[styles.mono, { fontSize: 14 }]}>mi</Text>}
          </View>
          <Text style={styles.mono}>
            {summary!.driveMiles > 0 ? `${summary!.driveTime} behind the wheel` : "add stops with places to estimate driving"}
          </Text>
          {summary!.restrictionCount > 0 && (
            <Text style={[styles.mono, { color: C.warning }]}>
              ⚠ {summary!.restrictionCount} restriction{summary!.restrictionCount === 1 ? "" : "s"} on this route
            </Text>
          )}
          {!bundle.hasRig && summary!.driveMiles > 0 && (
            <Text style={{ color: C.inkMuted, fontSize: 12.5 }}>
              Drive times are straight-line estimates until you set up your rig on the web.
            </Text>
          )}
          <View style={{ height: 1, backgroundColor: C.borderSoft }} />
          <Text style={styles.mono}>
            {summary!.stops} stops · {summary!.scheduled} set / {summary!.floating} floating · {summary!.openCount} open
            day{summary!.openCount === 1 ? "" : "s"} in {summary!.gapCount} gap{summary!.gapCount === 1 ? "" : "s"}
          </Text>
        </Card>
      </ScrollView>
    </>
  );
}

function StopRow({ row, onPress }: { row: RouteRowModel; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      {({ pressed }) => (
        <Card style={{ opacity: pressed ? 0.85 : 1, gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Text style={styles.stopName}>{row.stop.place.name}</Text>
            {row.floating && <FloatingTag />}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {row.dates && <Text style={styles.mono}>{row.dates}</Text>}
            {row.rating > 0 && <Stars value={row.rating} size={12} />}
            {row.reservations.length > 0 && (
              <Text style={styles.mono}>
                {row.reservations.length} reservation{row.reservations.length === 1 ? "" : "s"}
              </Text>
            )}
            {row.ideas.length > 0 && (
              <Text style={styles.mono}>
                {row.ideas.length} idea{row.ideas.length === 1 ? "" : "s"}
              </Text>
            )}
          </View>
          {row.note ? (
            <Text style={{ color: C.inkMuted, fontSize: 13, fontStyle: "italic" }} numberOfLines={2}>
              {row.note}
            </Text>
          ) : null}
        </Card>
      )}
    </Pressable>
  );
}

/**
 * A drive has exactly three renderings, and only one is amber — the same
 * contract as the web's connector: clean · restricted (notices) · estimate.
 * Navigate hands Google Maps origin + destination, never the corridor.
 */
function Drive({ drive }: { drive: RouteDrive }) {
  const restricted = drive.notices.length > 0;
  return (
    <View
      style={[
        styles.drive,
        restricted && { borderWidth: 1, borderColor: C.border, borderLeftWidth: 3, borderLeftColor: C.travel, backgroundColor: C.surface },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Text style={{ color: C.ink, fontSize: 13 }}>🚐</Text>
        <Text style={[styles.mono, { color: C.inkMuted }]}>{drive.label}</Text>
        {drive.primaryRoad && <Text style={styles.mono}>· {drive.primaryRoad}</Text>}
        {drive.estimate && <EstimateChip />}
        <View style={{ marginLeft: "auto" }}>
          <Button onPress={() => void Linking.openURL(drive.navUrl)}>Navigate</Button>
        </View>
      </View>
      {restricted && (
        <>
          <Text style={{ color: C.warning, fontSize: 11.5, textAlign: "right" }}>
            Navigation may not follow the RV-safe route — check notices.
          </Text>
          {drive.notices.map((n, i) => (
            <View key={`${n.code}-${i}`} style={styles.notice}>
              <Text style={{ color: C.warning, fontSize: 12.5 }}>⚠ {n.message}</Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

function Legend({ color, label, outlined }: { color: string; label: string; outlined?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color, borderWidth: outlined ? 1 : 0, borderColor: C.borderHi }} />
      <Text style={{ fontFamily: F.mono, fontSize: 10, color: C.inkFaded }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 10, paddingBottom: 56 },
  h1: { color: C.ink, fontSize: 30, fontWeight: "800", letterSpacing: -0.6, marginTop: -4 },
  h2: { color: C.ink, fontSize: 19, fontWeight: "800", marginTop: -4 },
  hero: { fontFamily: F.mono, color: C.ink, fontSize: 30, fontWeight: "700" },
  mono: { fontFamily: F.mono, color: C.inkFaded, fontSize: 12 },
  stopName: { color: C.ink, fontSize: 17, fontWeight: "700" },
  drive: { marginLeft: 12, paddingVertical: 6, paddingHorizontal: 10, borderRadius: R.md, gap: 8 },
  notice: {
    backgroundColor: C.warningSoft,
    borderRadius: R.sm,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
});
