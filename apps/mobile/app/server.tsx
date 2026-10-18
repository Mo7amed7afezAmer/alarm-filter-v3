import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Button, Text, TextInput, View } from "react-native";
import { saveServer } from "../src/server";
import { readServerUrl } from "../src/storage";

/** P7-T07: the server address (HTTPS to Caddy, D-06), checked with /api/health before it is saved. */
export default function ServerScreen() {
  const [server, setServer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void readServerUrl().then((u) => setServer(u ?? ""));
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveServer(server);
      router.replace("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
      <Text style={{ fontSize: 22, fontWeight: "600", marginBottom: 8 }}>Server</Text>
      <Text style={{ color: "#555", marginBottom: 16 }}>
        The NOC server&apos;s address on the LAN, e.g. https://noc-alarms.lan. The phone must trust the NOC root certificate.
      </Text>
      <TextInput
        style={{ borderWidth: 1, borderColor: "#999", borderRadius: 6, padding: 10, marginBottom: 12 }}
        placeholder="https://noc-alarms.lan"
        value={server}
        onChangeText={setServer}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      {error ? <Text style={{ color: "#b00020", marginBottom: 12 }}>{error}</Text> : null}
      <Button title={busy ? "Checking…" : "Save"} onPress={() => void save()} disabled={busy} />
    </View>
  );
}
