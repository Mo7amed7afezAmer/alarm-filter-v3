import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));

import { checkServer, normalizeServerUrl, saveServer, UNREACHABLE_HINT } from "./server";

const app = fileURLToPath(new URL("..", import.meta.url));
const plugin = createRequire(import.meta.url)("../plugins/with-lan-trust.js") as { NETWORK_SECURITY_CONFIG: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// P7-T07: the server address screen; HTTPS to Caddy's internal CA (D-06), nothing in clear text.
describe("server address (P7-T07)", () => {
  it.each([
    ["noc-alarms.lan", "https://noc-alarms.lan"],
    ["  https://noc-alarms.lan/  ", "https://noc-alarms.lan"],
    ["HTTPS://NOC-Alarms.LAN", "https://noc-alarms.lan"],
    ["10.20.0.5", "https://10.20.0.5"],
    ["https://10.20.0.5:8443", "https://10.20.0.5:8443"],
  ])("%j → %s", (input, url) => {
    expect(normalizeServerUrl(input)).toBe(url);
  });

  it.each([
    ["", "Enter the server address"],
    ["http://noc-alarms.lan", "https://"],
    ["ftp://noc-alarms.lan", "https://"],
    ["https://noc-alarms.lan/alarms", "only the server address"],
    ["https://noc-alarms.lan?x=1", "only the server address"],
    ["https://admin:pw@noc-alarms.lan", "only the server address"],
    ["https://", "not a server address"],
    ["noc alarms", "not a server address"],
  ])("rejects %j", (input, message) => {
    expect(() => normalizeServerUrl(input)).toThrow(message);
  });

  it("checks the public /api/health (FR-70) before saving; 200 and 503 both mean the server answered", async () => {
    const fetch = vi.fn(async () => json({ status: "ok", worker: { stale: false } }));
    await expect(checkServer("https://noc.lan", fetch)).resolves.toEqual({ status: "ok" });
    expect(fetch).toHaveBeenCalledWith("https://noc.lan/api/health", expect.objectContaining({ method: "GET" }));
    await expect(checkServer("https://noc.lan", async () => json({ status: "db_error" }, 503))).resolves.toEqual({ status: "db_error" });
  });

  it("another server's answer is not the NOC alarm server", async () => {
    await expect(checkServer("https://router.lan", async () => new Response("<html></html>", { status: 200 }))).rejects.toThrow(
      "not the NOC alarm server",
    );
    await expect(checkServer("https://router.lan", async () => json({ hello: 1 }))).rejects.toThrow("not the NOC alarm server");
  });

  it("no answer (off the LAN, or the NOC root certificate not trusted) explains both", async () => {
    const err = checkServer("https://noc.lan", async () => Promise.reject(new TypeError("Network request failed")));
    await expect(err).rejects.toThrow(`Cannot reach https://noc.lan. ${UNREACHABLE_HINT}`);
    expect(UNREACHABLE_HINT).toMatch(/NOC Wi-Fi/);
    expect(UNREACHABLE_HINT).toMatch(/root certificate/);
  });

  it("saves the normalized address only after the check passes", async () => {
    const write = vi.fn(async () => undefined);
    await expect(saveServer(" noc.lan/ ", async () => json({ status: "ok" }), write)).resolves.toBe("https://noc.lan");
    expect(write).toHaveBeenCalledWith("https://noc.lan");
    write.mockClear();
    await expect(saveServer("noc.lan", async () => Promise.reject(new TypeError("offline")), write)).rejects.toThrow("Cannot reach");
    await expect(saveServer("http://noc.lan", async () => json({ status: "ok" }), write)).rejects.toThrow("https://");
    expect(write).not.toHaveBeenCalled();
  });
});

describe("native networking config (P7-T07, D-06)", () => {
  it("Android trusts system and user-installed CAs (the NOC root) and permits no clear text", () => {
    const xml = plugin.NETWORK_SECURITY_CONFIG;
    expect(xml).toContain('<base-config cleartextTrafficPermitted="false">');
    expect(xml).toContain('<certificates src="system" />');
    expect(xml).toContain('<certificates src="user" />');
  });

  it("the resolved app config wires it into the manifest and keeps iOS ATS strict", () => {
    const r = spawnSync("npx", ["expo", "config", "--type", "introspect", "--json"], { cwd: app, encoding: "utf8", shell: true });
    expect(r.status, r.stderr).toBe(0);
    const config = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))) as {
      plugins: unknown[];
      ios: { infoPlist: Record<string, unknown> };
      _internal: { modResults: { android: { manifest: { manifest: { application: { $: Record<string, string> }[] } } } } };
    };
    expect(config.plugins).toContain("./plugins/with-lan-trust");
    const application = config._internal.modResults.android.manifest.manifest.application[0]!.$;
    expect(application["android:networkSecurityConfig"]).toBe("@xml/network_security_config");
    expect(application["android:usesCleartextTraffic"]).toBe("false");
    expect(config.ios.infoPlist.NSAppTransportSecurity).toEqual({ NSAllowsArbitraryLoads: false });
  }, 120_000);
});
