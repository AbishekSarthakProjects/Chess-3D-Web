import type { NextConfig } from "next";
import { config } from "dotenv";

// Force load .env.local so it takes precedence over system env vars
config({ path: ".env.local", override: true });

const nextConfig: NextConfig = {
  output: "export",
  experimental: {
    optimizePackageImports: ['@react-three/drei', '@react-three/fiber', 'three'],
  },
};

export default nextConfig;
