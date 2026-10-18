// P7-T07 (D-06): the app reaches Caddy over HTTPS with certificates from Caddy's internal CA. The
// NOC installs that root once on each phone (RUNBOOK "TLS trust"). Android apps ignore user-installed
// CAs unless the network security config lists them, so this plugin adds one; clear text stays off.
// iOS trusts a root the user has enabled in Certificate Trust Settings; ATS stays strict (app.json).
const fs = require("node:fs");
const path = require("node:path");
const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

const NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
      <certificates src="user" />
    </trust-anchors>
  </base-config>
</network-security-config>
`;

function withLanTrust(config) {
  config = withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application[0];
    app.$["android:networkSecurityConfig"] = "@xml/network_security_config";
    app.$["android:usesCleartextTraffic"] = "false";
    return c;
  });
  return withDangerousMod(config, [
    "android",
    async (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "network_security_config.xml"), NETWORK_SECURITY_CONFIG);
      return c;
    },
  ]);
}

module.exports = withLanTrust;
module.exports.NETWORK_SECURITY_CONFIG = NETWORK_SECURITY_CONFIG;
