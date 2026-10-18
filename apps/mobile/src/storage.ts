// P7-T02: the session (API token + user) lives only in expo-secure-store (Keychain / Keystore),
// never in AsyncStorage.
import * as SecureStore from "expo-secure-store";
import type { Role } from "./roles";

export const SESSION_KEY = "noc.session";
export const SERVER_URL_KEY = "noc.serverUrl";

export interface SessionUser {
  id: number;
  email: string;
  role: Role;
}

export interface Session {
  token: string;
  user: SessionUser;
}

export async function readSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    return null;
  }
}

export const writeSession = (s: Session): Promise<void> => SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(s));

export const deleteSession = (): Promise<void> => SecureStore.deleteItemAsync(SESSION_KEY);

/** The server the app talks to (set on the server screen, P7-T07); null until chosen. */
export const readServerUrl = (): Promise<string | null> => SecureStore.getItemAsync(SERVER_URL_KEY);

export const writeServerUrl = (url: string): Promise<void> => SecureStore.setItemAsync(SERVER_URL_KEY, url.replace(/\/+$/, ""));
