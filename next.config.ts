import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(process.cwd()),
  },
  async rewrites() {
    return [
      {
        source: "/games/prompdojo/play",
        destination: "/",
      },
      {
        source: "/games/prompdojo/play/:path*",
        destination: "/:path*",
      },
    ];
  },
};

export default nextConfig;
