import path from "node:path";
import type { NextConfig } from "next";

const PUBLIC_MOUNT_PREFIX = "/games/prompdojo/play";

function resolveAssetPrefix(): string | undefined {
  if (process.env.ASSET_PREFIX) {
    return process.env.ASSET_PREFIX;
  }

  const vercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProductionUrl) {
    return `https://${vercelProductionUrl}`;
  }

  return undefined;
}

const assetPrefix = resolveAssetPrefix();

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(process.cwd()),
  },
  ...(assetPrefix ? { assetPrefix } : {}),
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
