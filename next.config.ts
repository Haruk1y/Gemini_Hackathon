import path from "node:path";
import type { NextConfig } from "next";

const PUBLIC_MOUNT_PREFIX = "/games/prompdojo/play";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(process.cwd()),
  },
  assetPrefix: PUBLIC_MOUNT_PREFIX,
  async rewrites() {
    return [
      {
        source: PUBLIC_MOUNT_PREFIX,
        destination: "/",
      },
      {
        source: `${PUBLIC_MOUNT_PREFIX}/:path*`,
        destination: "/:path*",
      },
    ];
  },
};

export default nextConfig;
