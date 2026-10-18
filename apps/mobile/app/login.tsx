import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Button, Text, TextInput, View } from "react-native";
import { useSession } from "../src/session-context";
import { readServerUrl } from "../src/storage";

const input = { borderWidth: 1, borderColor: "#999", borderRadius: 6, padding: 10, marginBottom: 12 } as const;

/** P7-T02: e-mail + password → POST /api/v1/auth/login; the token goes to expo-secure-store. The
 * server address is set on its own screen (P7-T07). */
export default function Login() {
  const { store } = useSession();
  const [server, setServer] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void readServerUrl().then((u) => {
      if (u) setServer(u);
      else router.replace("/server");
    });
  }, []);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      await store.login(email.trim(), password);
      setPassword("");
      router.replace("/alarms");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
      <Text style={{ fontSize: 22, fontWeight: "600", marginBottom: 20 }}>NOC Alarms</Text>
      <Text style={{ color: "#555", marginBottom: 12 }}>
        {server ?? "…"}{" "}
        <Text style={{ color: "#1565c0" }} onPress={() => router.push("/server")}>
          Change server
        </Text>
      </Text>
      <TextInput
        style={input}
        placeholder="E-mail"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
      />
      <TextInput style={input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />
      {error ? <Text style={{ color: "#b00020", marginBottom: 12 }}>{error}</Text> : null}
      <Button title={busy ? "Signing in…" : "Sign in"} onPress={() => void signIn()} disabled={busy} />
    </View>
  );
}
