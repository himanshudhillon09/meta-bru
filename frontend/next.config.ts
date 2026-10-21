import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Turbopack scoped to the frontend even if a lockfile exists at the
  // repository root.
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
