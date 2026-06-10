import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for small Docker images (Railway/Fly).
  output: "standalone",
};

export default nextConfig;
