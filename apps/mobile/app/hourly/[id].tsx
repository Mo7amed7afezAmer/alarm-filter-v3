import type { HourlyFilter, HourlyRow } from "@alarm/core";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Button, FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { UnauthorizedError } from "../../src/api";
import { FILTER_FACETS, reportFacets, sheetTabs, toggleValue, visibleRows, type FacetKey, type ProcessedReport } from "../../src/hourly";
import { DEFAULT_COLUMNS } from "../../src/export/columns";
import { shareXlsx } from "../../src/files";
import { nativeFiles, nativeShare } from "../../src/files-native";
import { HourlyImages } from "../../src/hourly-images";
import { useSession } from "../../src/session-context";

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Text
        style={{
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: 12,
          backgroundColor: on ? "#1565c0" : "#eee",
          color: on ? "#fff" : "#000",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Row({ r }: { r: HourlyRow }) {
  return (
    <View style={{ padding: 10, borderBottomWidth: 1, borderColor: "#eee" }}>
      <Text style={{ fontWeight: "600" }}>{r.alarmName}</Text>
      <Text>
        {r.siteCode ?? "—"}
        {r.siteName ? ` · ${r.siteName}` : ""}
        {r.vip ? " · VIP" : ""}
      </Text>
      <Text style={{ color: "#555" }}>
        {r.alarmTime}
        {r.clockInvalid ? " (clock invalid)" : ""} · {r.office ?? "no office"} · {r.category}
      </Text>
    </View>
  );
}

/** One multi-select filter (FR-59): values of the open tab with counts, collapsed by default. */
function Facet({
  label,
  values,
  selected,
  onToggle,
}: {
  label: string;
  values: { value: string; count: number }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ paddingHorizontal: 8, paddingTop: 6 }}>
      <Pressable onPress={() => setOpen(!open)}>
        <Text style={{ fontWeight: "600" }}>
          {open ? "▾" : "▸"} {label}
          {selected.length ? ` (${selected.length})` : ""}
        </Text>
      </Pressable>
      {open ? (
        <ScrollView horizontal style={{ paddingVertical: 4 }} contentContainerStyle={{ gap: 6 }}>
          {values.slice(0, 200).map((v) => (
            <Chip key={v.value} label={`${v.value} (${v.count})`} on={selected.includes(v.value)} onPress={() => onToggle(v.value)} />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const inputStyle = { flex: 1, borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 8 } as const;

/** P7-T04: one report parsed on the device; sheet tabs and the web's filters (FR-59, FR-62), no network. */
export default function HourlyReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { reports } = useSession();
  const [report, setReport] = useState<ProcessedReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [filter, setFilter] = useState<HourlyFilter>({});
  const [images, setImages] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    reports.open(id).then(
      (r) => {
        if (live) setReport(r);
      },
      (err: unknown) => {
        if (live && !(err instanceof UnauthorizedError)) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      live = false;
    };
  }, [id, reports]);

  const rows = useMemo(() => (report ? visibleRows(report.rows, sheet, filter) : []), [report, sheet, filter]);
  const facets = useMemo(() => (report ? reportFacets(report.rows, sheet) : {}), [report, sheet]);
  const set = (k: "from" | "to" | "q", v: string) => setFilter((f) => ({ ...f, [k]: v.trim() ? v : undefined }));
  const toggle = (k: FacetKey, v: string) => setFilter((f) => toggleValue(f, k, v));
  /** FR-60: the shown rows, default columns; the temp file is deleted once the share sheet closes. */
  const exportXlsx = async () => {
    setSharing(true);
    setShareError(null);
    try {
      await shareXlsx(nativeFiles, nativeShare, id, rows, DEFAULT_COLUMNS);
    } catch (err) {
      setShareError(err instanceof Error ? err.message : String(err));
    } finally {
      setSharing(false);
    }
  };

  if (error) return <Text style={{ padding: 16, color: "#b00020" }}>{error}</Text>;
  if (!report) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text>Processing the report on this phone…</Text>
      </View>
    );
  }
  const header = (
    <View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, padding: 8 }}>
        <Chip label={`All sheets (${report.rows.length})`} on={sheet === null} onPress={() => setSheet(null)} />
        {sheetTabs(report.rows).map((t) => (
          <Chip key={t.sheet} label={`${t.sheet} (${t.count})`} on={sheet === t.sheet} onPress={() => setSheet(t.sheet)} />
        ))}
      </View>
      <TextInput
        placeholder="Search…"
        value={filter.q ?? ""}
        onChangeText={(v) => set("q", v)}
        style={{ ...inputStyle, flex: undefined, marginHorizontal: 8 }}
      />
      <View style={{ flexDirection: "row", gap: 6, padding: 8 }}>
        <TextInput
          placeholder="From YYYY-MM-DD HH:mm:ss"
          value={filter.from ?? ""}
          onChangeText={(v) => set("from", v)}
          style={inputStyle}
        />
        <TextInput placeholder="To YYYY-MM-DD HH:mm:ss" value={filter.to ?? ""} onChangeText={(v) => set("to", v)} style={inputStyle} />
      </View>
      <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 8 }}>
        {(
          [
            ["All", undefined],
            ["VIP only", true],
            ["Not VIP", false],
          ] as const
        ).map(([label, vip]) => (
          <Chip key={label} label={label} on={filter.vip === vip} onPress={() => setFilter((f) => ({ ...f, vip }))} />
        ))}
      </View>
      {FILTER_FACETS.map(({ key, field, label }) => (
        <Facet
          key={key}
          label={label}
          values={facets[field] ?? []}
          selected={(filter[key] as string[] | undefined) ?? []}
          onToggle={(v) => toggle(key, v)}
        />
      ))}
      <View style={{ flexDirection: "row", gap: 8, padding: 8 }}>
        <Button title={sharing ? "Sharing…" : "Share .xlsx"} disabled={sharing || !rows.length} onPress={() => void exportXlsx()} />
        <Button title="Images" disabled={!rows.length} onPress={() => setImages(true)} />
      </View>
      {shareError ? <Text style={{ paddingHorizontal: 8, color: "#b00020" }}>{shareError}</Text> : null}
      <Text style={{ padding: 8, color: "#555" }}>
        {rows.length.toLocaleString("en-US")} shown · processed in {(report.ms / 1000).toFixed(1)} s · {report.stats.unmatched} unmatched
        site codes · {report.stats.emptyCodes} empty codes
      </Text>
    </View>
  );
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: `${report.stats.rows.toLocaleString("en-US")} rows` }} />
      {images ? <HourlyImages id={id} title={id} rows={rows} onClose={() => setImages(false)} /> : null}
      <FlatList
        data={rows}
        ListHeaderComponent={header}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => <Row r={item} />}
        initialNumToRender={20}
        windowSize={7}
      />
    </View>
  );
}
