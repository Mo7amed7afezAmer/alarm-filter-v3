// P7-T01: Metro for the pnpm monorepo. Expo's default config follows workspace symlinks; the repo
// root is watched so packages/core (TypeScript sources) is bundled unchanged.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules"), path.resolve(workspaceRoot, "node_modules")];

// D-11: the server extracts hourly RARs (`…/xlsx`); the app never calls core's extractor, so its
// node-unrar-js dependency (which needs Node's fs) is replaced by an empty module. Core stays unchanged.
const SERVER_ONLY = new Set(["node-unrar-js"]);
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) =>
  SERVER_ONLY.has(moduleName) ? { type: "empty" } : (resolveRequest ?? context.resolveRequest)(context, moduleName, platform);

module.exports = config;
