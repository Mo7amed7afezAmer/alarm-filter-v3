import type { HourlyRow } from "@alarm/core";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { UnauthorizedError } from "../../src/api";
import { cellText, HOURLY_COLUMNS, type HourlyColumn } from "../../src/export/columns";
import { useSession } from "../../src/session-context";

/** The web compare page's columns (components/hourly-compare.tsx). */
const COLS: HourlyColumn[] = ["sheet", "siteCode", "siteName", "alarmName", "alarmTime", "office", "category"];

function Rows({ title, rows }: { title: string; rows: HourlyRow[] }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: "700", padding: 8 }}>
        {title} {rows.length}
      </Text>
      {rows.slice(0, 500).map((r, i) => (
        <View key={i} style={{ paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1, borderColor: "#eee" }}>
          <Text style={{ fontWeight: "600" }}>{r.alarmName}</Text>
          <Text style={{ color: "#555" }}>
            {COLS.filter((c) => c !== "alarmName")
              .map((c) => cellText(HOURLY_COLUMNS[c].value(r)))
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** P7-T06 (FR-61): two reports compared on the phone; new and disappeared rows. */
export default function HourlyCompareScreen() {
  const { a, b } = useLocalSearchParams<{ a: string; b: string }>();
  const { reports } = useSession();
  const [diff, setDiff] = useState<{ new: HourlyRow[]; disappeared: HourlyRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    reports.compare(a, b).then(
      (d) => {
        if (live) setDiff(d);
      },
      (err: unknown) => {
        if (live && !(err instanceof UnauthorizedError)) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      live = false;
    };
  }, [a, b, reports]);

  if (error) return <Text style={{ padding: 16, color: "#b00020" }}>{error}</Text>;
  if (!diff) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text>Processing both reports on this phone…</Text>
      </View>
    );
  }
  return (
    <ScrollView>
      <Stack.Screen options={{ title: "Compare reports" }} />
      <Rows title="New" rows={diff.new} />
      <Rows title="Disappeared" rows={diff.disappeared} />
    </ScrollView>
  );
}
