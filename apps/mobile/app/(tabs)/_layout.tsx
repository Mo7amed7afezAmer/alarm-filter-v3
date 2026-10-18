import { Redirect, Tabs } from "expo-router";
import { useEffect, useState } from "react";
import { Button, Text, View } from "react-native";
import { BADGE_POLL_MS, unreadCount } from "../../src/alarms";
import { entryPointsFor, type EntryPoint } from "../../src/roles";
import { useSession } from "../../src/session-context";

const TITLES: Record<EntryPoint, string> = { alarms: "Alarms", cleared: "Cleared", hourly: "Hourly" };

/** P7-T02: the tabs a role reaches (no admin screens), the office label and sign-out. */
export default function TabsLayout() {
  const { session, store, api } = useSession();
  const [office, setOffice] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (session) void store.loadOffice().then(setOffice, () => setOffice(null));
  }, [session, store]);

  // FR-46 on the phone: unread notifications as a badge on the Alarms tab, every 30 s.
  useEffect(() => {
    if (!session) return;
    const poll = () => void unreadCount(api).then(setUnread, () => undefined);
    poll();
    const t = setInterval(poll, BADGE_POLL_MS);
    return () => clearInterval(t);
  }, [session, api]);

  if (!session) return <Redirect href="/login" />;
  const entries = entryPointsFor(session.user.role);

  return (
    <Tabs
      screenOptions={{
        headerTitle: () => (
          <View>
            <Text style={{ fontWeight: "600" }}>{office ?? "NOC Alarms"}</Text>
            <Text style={{ fontSize: 12, color: "#666" }}>
              {session.user.email} · {session.user.role}
            </Text>
          </View>
        ),
        headerRight: () => <Button title="Sign out" onPress={() => void store.logout()} />,
      }}
    >
      {(["alarms", "cleared", "hourly"] as const).map((name) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: TITLES[name],
            href: entries.includes(name) ? undefined : null,
            tabBarBadge: name === "alarms" && unread > 0 ? unread : undefined,
          }}
        />
      ))}
    </Tabs>
  );
}
