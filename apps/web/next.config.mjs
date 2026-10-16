import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // NFR-33: standalone server for the web image (BUILD_STANDALONE=1 in apps/web/Dockerfile; the
  // standalone copy needs symlinks, which local Windows builds cannot create).
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  // NEXT_DIST_DIR: separate build dir for the e2e server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Workspace packages ship TypeScript sources.
  transpilePackages: ["@alarm/core", "@alarm/db"],
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ["@prisma/client", "bcryptjs", "node-unrar-js"],
    // Trace files from the monorepo root so workspace packages land in the standalone output.
    outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
    // unrar.wasm is read at run time by the /xlsx route (D-11).
    outputFileTracingIncludes: { "/api/v1/hourly-reports/[id]/xlsx": ["../../node_modules/.pnpm/node-unrar-js@*/node_modules/node-unrar-js/esm/js/unrar.wasm"] },
  },
};

export default nextConfig;
