// Copies node-unrar-js's unrar.wasm to public/ so the hourly Web Worker can fetch it (D-10).
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = createRequire(import.meta.url).resolve(["node-unrar-js", "esm", "js", "unrar.wasm"].join("/"));
mkdirSync(join(here, "..", "public"), { recursive: true });
copyFileSync(src, join(here, "..", "public", "unrar.wasm"));
