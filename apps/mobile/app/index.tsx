import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "../src/session-context";

/** Start: the alarms when a session is stored, else the login screen. */
export default function Index() {
  const { session, ready } = useSession();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }
  return <Redirect href={session ? "/alarms" : "/login"} />;
}
