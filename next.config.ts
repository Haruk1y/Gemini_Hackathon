import path from "node:path";
import type { NextConfig } from "next";

const PUBLIC_MOUNT_PREFIX = "/games/prompdojo/play";

function normalizePrefix(value: string): string {
  if (!value) {
    return "";
  }

  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function resolveAssetPrefix(): string {
  const configuredPrefix = process.env.ASSET_PREFIX?.trim();
  if (configuredPrefix) {
    return normalizePrefix(configuredPrefix);
  }

  // Always emit `_next` assets under the public mount path so reverse proxies
  // that only expose `/games/prompdojo/play/*` can still load CSS and JS.
  // The rewrite below keeps the root deployment working on `prompdojo.vercel.app`.
  return PUBLIC_MOUNT_PREFIX;
}

const assetPrefix = resolveAssetPrefix();
const publicAppOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? "";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(process.cwd()),
  },
  assetPrefix,
  env: {
    NEXT_PUBLIC_APP_ORIGIN: publicAppOrigin,
  },
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
