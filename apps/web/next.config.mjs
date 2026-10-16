/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship TypeScript sources.
  transpilePackages: ["@alarm/core", "@alarm/db"],
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ["@prisma/client", "bcryptjs"],
  },
};

export default nextConfig;
