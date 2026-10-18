import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory expo-secure-store; the app must keep its token there and nowhere else (P7-T02).
const secure = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => secure.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => void secure.set(k, v)),
  deleteItemAsync: vi.fn(async (k: string) => void secure.delete(k)),
}));

import * as SecureStore from "expo-secure-store";
import { ApiClient, UnauthorizedError } from "./api";
import { entryPointsFor, canOpenHourlyReports } from "./roles";
import { SessionStore } from "./session";
import { SESSION_KEY } from "./storage";

const app = fileURLToPath(new URL("..", import.meta.url));
const BASE = "https://noc.lan";

type Call = { url: string; init: RequestInit };
function fakeFetch(routes: Record<string, (init: RequestInit) => Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const key = `${init.method ?? "GET"} ${url.replace(BASE, "").split("?")[0]}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected ${key}`);
    return handler(init);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const USER = { id: 7, email: "viewer@noc.test", role: "VIEWER" as const };

describe("mobile sign-in (P7-T02)", () => {
  beforeEach(() => {
    secure.clear();
    vi.mocked(SecureStore.setItemAsync).mockClear();
  });

  it("login posts e-mail + password and keeps the token in expo-secure-store", async () => {
    const { fn, calls } = fakeFetch({
      "POST /api/v1/auth/login": () => Response.json({ token: "tok-1", user: USER }),
    });
    const store = new SessionStore({ fetch: fn, serverUrl: async () => BASE });
    await store.login("viewer@noc.test", "secret-pass");

    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ email: "viewer@noc.test", password: "secret-pass" });
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(SESSION_KEY, expect.stringContaining("tok-1"));
    expect(JSON.parse(secure.get(SESSION_KEY)!)).toEqual({ token: "tok-1", user: USER });
    expect(store.current?.user.role).toBe("VIEWER");
  });

  it("a wrong password shows the server's message and stores nothing", async () => {
    const { fn } = fakeFetch({
      "POST /api/v1/auth/login": () =>
        Response.json({ error: { code: "UNAUTHORIZED", message: "wrong e-mail or password" } }, { status: 401 }),
    });
    const store = new SessionStore({ fetch: fn, serverUrl: async () => BASE });
    await expect(store.login("viewer@noc.test", "bad")).rejects.toThrow("wrong e-mail or password");
    expect(secure.size).toBe(0);
  });

  it("never uses AsyncStorage: no dependency, no import anywhere in the app", () => {
    const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies)).not.toContain("@react-native-async-storage/async-storage");
    const files = ["app", "src"].flatMap((d) =>
      (readdirSync(join(app, d), { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f)).map((f) => join(app, d, f)),
    );
    expect(files.length).toBeGreaterThan(3);
    // Imports or requires of AsyncStorage (comments may mention it).
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/(from|require\()\s*["'][^"']*async-storage/);
  });

  it("sends the token as a bearer token", async () => {
    secure.set(SESSION_KEY, JSON.stringify({ token: "tok-1", user: USER }));
    const { fn, calls } = fakeFetch({ "GET /api/v1/alarms": () => Response.json({ items: [], total: 0 }) });
    const store = new SessionStore({ fetch: fn, serverUrl: async () => BASE });
    await store.restore();
    await new ApiClient(store).get("/api/v1/alarms?status=active");
    expect(new Headers(calls[0]!.init.headers).get("Authorization")).toBe("Bearer tok-1");
  });

  it("an expired or revoked token (401) signs out and returns to the login screen", async () => {
    secure.set(SESSION_KEY, JSON.stringify({ token: "old", user: USER }));
    const { fn } = fakeFetch({
      "GET /api/v1/alarms": () =>
        Response.json({ error: { code: "UNAUTHORIZED", message: "invalid or revoked API token" } }, { status: 401 }),
    });
    const toLogin = vi.fn();
    const store = new SessionStore({ fetch: fn, serverUrl: async () => BASE, onSignedOut: toLogin });
    await store.restore();
    await expect(new ApiClient(store).get("/api/v1/alarms?status=active")).rejects.toBeInstanceOf(UnauthorizedError);
    expect(store.current).toBeNull();
    expect(secure.has(SESSION_KEY)).toBe(false);
    expect(toLogin).toHaveBeenCalledTimes(1);
  });

  it("restore() checks a stored token and goes to login when the server rejects it", async () => {
    secure.set(SESSION_KEY, JSON.stringify({ token: "old", user: USER }));
    const { fn } = fakeFetch({
      "GET /api/v1/stats/summary": () => Response.json({ error: { code: "UNAUTHORIZED", message: "x" } }, { status: 401 }),
    });
    const toLogin = vi.fn();
    const store = new SessionStore({ fetch: fn, serverUrl: async () => BASE, onSignedOut: toLogin });
    await store.restore();
    expect(await store.loadOffice()).toBeNull();
    expect(store.current).toBeNull();
    expect(toLogin).toHaveBeenCalled();
  });

  it("shows the office label from /stats/summary", async () => {
    secure.set(SESSION_KEY, JSON.stringify({ token: "tok-1", user: USER }));
    const { fn } = fakeFetch({ "GET /api/v1/stats/summary": () => Response.json({ office: "DN/Kafr ElDawar" }) });
    const store = new SessionStore({ fetch: fn, serverUrl: async () => BASE });
    await store.restore();
    expect(await store.loadOffice()).toBe("DN/Kafr ElDawar");
  });

  it("logout revokes the token on the server and deletes it from the device", async () => {
    secure.set(SESSION_KEY, JSON.stringify({ token: "tok-1", user: USER }));
    const { fn, calls } = fakeFetch({ "POST /api/v1/auth/logout": () => new Response(null, { status: 204 }) });
    const cleared = vi.fn();
    const store = new SessionStore({ fetch: fn, serverUrl: async () => BASE, onSignedOut: cleared });
    await store.restore();
    await store.logout();
    expect(new Headers(calls[0]!.init.headers).get("Authorization")).toBe("Bearer tok-1");
    expect(secure.has(SESSION_KEY)).toBe(false);
    expect(cleared).toHaveBeenCalled();
  });

  it("logout still signs out on the device when the server is unreachable", async () => {
    secure.set(SESSION_KEY, JSON.stringify({ token: "tok-1", user: USER }));
    const fn = vi.fn(async () => {
      throw new TypeError("Network request failed");
    }) as unknown as typeof fetch;
    const store = new SessionStore({ fetch: fn, serverUrl: async () => BASE });
    await store.restore();
    await store.logout();
    expect(secure.has(SESSION_KEY)).toBe(false);
  });
});

describe("entry points per role (P7-T02: admin screens stay web-only)", () => {
  it("a VIEWER sees alarms, cleared and the hourly list, and no admin entry points", () => {
    expect(entryPointsFor("VIEWER")).toEqual(["alarms", "cleared", "hourly"]);
    expect(canOpenHourlyReports("VIEWER")).toBe(false);
  });

  it("an OPERATOR or ADMIN can open hourly reports; nobody gets admin screens", () => {
    expect(canOpenHourlyReports("OPERATOR")).toBe(true);
    expect(canOpenHourlyReports("ADMIN")).toBe(true);
    for (const role of ["VIEWER", "OPERATOR", "ADMIN"] as const) {
      expect(entryPointsFor(role).some((e) => /admin|users|rules|settings|site-master/i.test(e))).toBe(false);
    }
  });
});
