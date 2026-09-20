/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  serverExternalPackages: ["pdf-parse", "pg", "bullmq", "ioredis"],
};

module.exports = nextConfig;
