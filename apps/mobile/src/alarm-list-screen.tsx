import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Linking, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { AGE_TICK_MS, ALARMS_REFRESH_MS, AlarmFeed, ageText, siteBadges, type AlarmItem, type FeedState } from "./alarms";
import { UnauthorizedError } from "./api";
import { signOutHandlers, useSession } from "./session-context";

const CATEGORIES = ["", "DOWN", "POWER", "OTHER"] as const;
const time = new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "short" });

function useNow(ms: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function Row({ a, status, now }: { a: AlarmItem; status: "active" | "cleared"; now: Date }) {
  const badges = siteBadges(a);
  return (
    <View style={{ padding: 12, borderBottomWidth: 1, borderColor: "#ddd" }}>
      <Text style={{ fontWeight: "600" }}>{a.alarmName}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <Text>{a.site}</Text>
        {badges.map((b) => (
          <Text
            key={b}
            style={{ fontSize: 11, paddingHorizontal: 6, borderRadius: 4, backgroundColor: b === "VIP" ? "#ffd54f" : "#e0e0e0" }}
          >
            {b}
          </Text>
        ))}
      </View>
      <Text style={{ color: "#555" }}>
        {a.category} ·{" "}
        {status === "active"
          ? `age ${ageText(new Date(a.alarmTime), now)}`
          : `cleared ${a.clearTime ? time.format(new Date(a.clearTime)) : "—"} · ${a.durationMin ?? "—"} min`}
      </Text>
      {a.battery ? <Text style={{ color: "#555" }}>Battery {a.battery}</Text> : null}
      {a.phone ? (
        <Pressable onPress={() => void Linking.openURL(`tel:${a.phone!.split("/")[0]!.trim()}`)}>
          <Text style={{ color: "#1565c0" }}>{a.phone}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** P7-T03: the active or cleared list with filters, 60 s refresh, 30 s ages and an offline banner. */
export function AlarmListScreen({ status }: { status: "active" | "cleared" }) {
  const { api } = useSession();
  const feed = useMemo(() => new AlarmFeed(api), [api]);
  const [category, setCategory] = useState<string>("");
  const [site, setSite] = useState("");
  const [state, setState] = useState<FeedState>({ data: null, stale: false, fetchedAt: null, error: null });
  const [loading, setLoading] = useState(false);
  const now = useNow(AGE_TICK_MS);

  useEffect(() => {
    const clear = () => feed.clear();
    signOutHandlers.add(clear);
    return () => {
      signOutHandlers.delete(clear);
    };
  }, [feed]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setState(await feed.load({ status, category, site: site.trim() }));
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) throw err;
    } finally {
      setLoading(false);
    }
  }, [feed, status, category, site]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), ALARMS_REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  return (
    <View style={{ flex: 1 }}>
      {state.stale ? (
        <Text style={{ backgroundColor: "#fff3cd", padding: 8 }}>
          Offline — showing data from {state.fetchedAt ? time.format(state.fetchedAt) : "earlier"}
        </Text>
      ) : null}
      {state.error && !state.stale ? <Text style={{ backgroundColor: "#fdecea", padding: 8 }}>{state.error}</Text> : null}
      <View style={{ flexDirection: "row", padding: 8, gap: 6 }}>
        {CATEGORIES.map((c) => (
          <Pressable key={c || "all"} onPress={() => setCategory(c)}>
            <Text
              style={{
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 12,
                backgroundColor: category === c ? "#1565c0" : "#eee",
                color: category === c ? "#fff" : "#000",
              }}
            >
              {c || "All"}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        placeholder="Site contains…"
        value={site}
        onChangeText={setSite}
        autoCapitalize="characters"
        style={{ marginHorizontal: 8, marginBottom: 6, borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 8 }}
      />
      <Text style={{ paddingHorizontal: 8, color: "#555" }}>{state.data ? `${state.data.total.toLocaleString("en-US")} alarms` : ""}</Text>
      <FlatList
        data={state.data?.items ?? []}
        keyExtractor={(a) => String(a.id)}
        renderItem={({ item }) => <Row a={item} status={status} now={now} />}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
      />
    </View>
  );
}
