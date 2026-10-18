import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Button, FlatList, RefreshControl, Text, View } from "react-native";
import { UnauthorizedError } from "../../src/api";
import { reportPath, type ReportListItem, type ReportListPage } from "../../src/hourly";
import { canOpenHourlyReports } from "../../src/roles";
import { useSession } from "../../src/session-context";

/** FR-64 / NFR-06: the list refreshes every 60 s. */
const LIST_REFRESH_MS = 60_000;
const time = new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "short" });

/** P7-T04: hourly report list (FR-47); Open only for OPERATOR and ADMIN (FR-64). */
export default function HourlyScreen() {
  const { api, session } = useSession();
  const [items, setItems] = useState<ReportListItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** FR-61: two picked reports, newest pick last (like the web list). */
  const [pick, setPick] = useState<string[]>([]);
  const canOpen = session ? canOpenHourlyReports(session.user.role) : false;

  const load = useCallback(
    async (pageToken?: string) => {
      setLoading(true);
      try {
        const page = await api.get<ReportListPage>(reportPath(pageToken));
        setItems((prev) => (pageToken ? [...prev, ...page.reports] : page.reports));
        setNext(page.nextPageToken);
        setError(null);
      } catch (err) {
        if (!(err instanceof UnauthorizedError)) setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), LIST_REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  return (
    <View style={{ flex: 1 }}>
      {error ? <Text style={{ backgroundColor: "#fdecea", padding: 8 }}>{error}</Text> : null}
      {canOpen && pick.length === 2 ? (
        <Button
          title="Compare the two selected reports"
          onPress={() => router.push(`/hourly/compare?a=${encodeURIComponent(pick[1]!)}&b=${encodeURIComponent(pick[0]!)}`)}
        />
      ) : null}
      <FlatList
        data={items}
        keyExtractor={(r) => r.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
        onEndReached={() => {
          if (next) void load(next);
        }}
        renderItem={({ item }) => (
          <View style={{ padding: 12, borderBottomWidth: 1, borderColor: "#ddd" }}>
            <Text style={{ fontWeight: "600" }}>{item.subject}</Text>
            <Text style={{ color: "#555" }}>
              {time.format(new Date(item.receivedAt))} · {item.attachment ? item.attachment.filename : "no attachment"}
            </Text>
            {canOpen && item.attachment ? (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Button title="Open" onPress={() => router.push(`/hourly/${encodeURIComponent(item.id)}`)} />
                <Button
                  title={pick.includes(item.id) ? "Selected" : "Select"}
                  onPress={() => setPick((p) => (p.includes(item.id) ? p.filter((x) => x !== item.id) : [...p, item.id].slice(-2)))}
                />
              </View>
            ) : null}
          </View>
        )}
      />
    </View>
  );
}
