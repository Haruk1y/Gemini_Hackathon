import path from "node:path";
import type { NextConfig } from "next";

import {
  PUBLIC_MOUNT_PREFIX,
  resolveAssetPrefix,
  resolvePublicAppOrigin,
} from "./src/lib/config/public-origin";

const publicAppOrigin = resolvePublicAppOrigin(process.env);
const assetPrefix = resolveAssetPrefix(process.env);

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
