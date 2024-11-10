import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack(config) {
    config.experiments = {
      asyncWebAssembly: true,
      layers: true,
    };
    return config;
  },
  output: "out", // <=== enables static exports
  reactStrictMode: true,
};

export default nextConfig;
