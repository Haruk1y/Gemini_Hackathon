import path from "node:path";
import type { NextConfig } from "next";

import {
  PUBLIC_MOUNT_PREFIX,
  resolveAssetPrefix,
  resolvePublicAppOrigin,
} from "./src/lib/config/public-origin";

const isLocalDev = process.env.NODE_ENV === "development";
const publicAppOrigin = isLocalDev ? "" : resolvePublicAppOrigin(process.env);
const assetPrefix = isLocalDev ? "" : resolveAssetPrefix(process.env);

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
