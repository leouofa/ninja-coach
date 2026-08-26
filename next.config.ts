import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@huggingface/transformers", "better-sqlite3", "sqlite-vec"],
};

export default nextConfig;
