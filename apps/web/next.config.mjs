/** @type {import('next').NextConfig} */
const nextConfig = {
  // NEXT_DIST_DIR: separate build dir for the e2e server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Workspace packages ship TypeScript sources.
  transpilePackages: ["@alarm/core", "@alarm/db"],
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ["@prisma/client", "bcryptjs"],
  },
};

export default nextConfig;
