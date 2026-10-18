// P7-T06 (FR-63): the filtered rows as PNG pages (compact or default columns, 25/40/60/100 rows,
// per category by default), each captured with react-native-view-shot and shared, then deleted.
import type { HourlyRow } from "@alarm/core";
import { useMemo, useRef, useState } from "react";
import { Button, Modal, Pressable, ScrollView, Text, View, type HostInstance } from "react-native";
import { captureRef } from "react-native-view-shot";
import { cellText, DEFAULT_COLUMNS, HOURLY_COLUMNS, officeFills } from "./export/columns";
import { COMPACT_COLUMNS, DEFAULT_ROWS_PER_IMAGE, imagePages, ROWS_PER_IMAGE, type ImagePage } from "./export/images";
import { REPORT_FILE_PREFIX, shareCapture } from "./files";
import { nativeFiles, nativeShare } from "./files-native";

function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
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

function PageImage({
  id,
  title,
  page,
  compact,
  fills,
}: {
  id: string;
  title: string;
  page: ImagePage;
  compact: boolean;
  fills: Map<string, string>;
}) {
  const ref = useRef<HostInstance>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const columns = compact ? COMPACT_COLUMNS : DEFAULT_COLUMNS;
  const share = async () => {
    setBusy(true);
    setError(null);
    try {
      await shareCapture(nativeFiles, nativeShare, () =>
        captureRef(ref, { format: "png", result: "tmpfile", fileName: `${REPORT_FILE_PREFIX}${id}-${page.label}-${page.page}` }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const cell = { paddingHorizontal: 6, paddingVertical: 4, width: 140, fontSize: 12 } as const;
  return (
    <View style={{ marginBottom: 16 }}>
      <Button title={busy ? "Sharing…" : `Share ${page.label} ${page.page}/${page.pages}`} disabled={busy} onPress={() => void share()} />
      {error ? <Text style={{ color: "#b00020" }}>{error}</Text> : null}
      <ScrollView horizontal>
        <View ref={ref} collapsable={false} style={{ backgroundColor: "#fff" }}>
          <Text style={{ fontWeight: "700", padding: 6 }}>
            {title} — {page.label} {page.page}/{page.pages}
          </Text>
          <View style={{ flexDirection: "row", borderBottomWidth: 1 }}>
            {columns.map((c) => (
              <Text key={c} style={{ ...cell, fontWeight: "700" }}>
                {HOURLY_COLUMNS[c].header}
              </Text>
            ))}
          </View>
          {page.rows.map((r: HourlyRow, i) => (
            <View
              key={i}
              style={{ flexDirection: "row", backgroundColor: r.office && fills.get(r.office) ? `#${fills.get(r.office)}` : undefined }}
            >
              {columns.map((c) => (
                <Text key={c} numberOfLines={1} style={cell}>
                  {cellText(HOURLY_COLUMNS[c].value(r))}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

export function HourlyImages({ id, title, rows, onClose }: { id: string; title: string; rows: HourlyRow[]; onClose: () => void }) {
  const [compact, setCompact] = useState(false);
  const [perCategory, setPerCategory] = useState(true);
  const [rowsPerImage, setRowsPerImage] = useState<number>(DEFAULT_ROWS_PER_IMAGE);
  const pages = useMemo(() => imagePages(rows, rowsPerImage, perCategory), [rows, rowsPerImage, perCategory]);
  const fills = useMemo(() => officeFills(rows), [rows]);
  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, padding: 8, paddingTop: 48 }}>
        <Toggle label="Compact columns" on={compact} onPress={() => setCompact(!compact)} />
        <Toggle label="Per category" on={perCategory} onPress={() => setPerCategory(!perCategory)} />
        {ROWS_PER_IMAGE.map((n) => (
          <Toggle key={n} label={`${n} rows`} on={rowsPerImage === n} onPress={() => setRowsPerImage(n)} />
        ))}
        <Button title="Close" onPress={onClose} />
      </View>
      <ScrollView style={{ paddingHorizontal: 8 }}>
        {pages.map((p) => (
          <PageImage key={`${p.label}-${p.page}`} id={id} title={title} page={p} compact={compact} fills={fills} />
        ))}
      </ScrollView>
    </Modal>
  );
}
