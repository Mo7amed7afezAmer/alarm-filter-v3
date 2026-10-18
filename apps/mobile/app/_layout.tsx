import { Stack } from "expo-router";
import { SessionProvider } from "../src/session-context";

/** P7-T02: the session wraps every screen; the login screen has no header. */
export default function RootLayout() {
  return (
    <SessionProvider>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ title: "Sign in", headerBackVisible: false }} />
        <Stack.Screen name="server" options={{ title: "Server" }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </SessionProvider>
  );
}
