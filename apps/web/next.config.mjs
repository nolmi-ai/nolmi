/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@twin-lab/shared"],
  // Standalone-Output: Next bündelt Server + nur die nötigen node_modules
  // unter .next/standalone/ — minimales Production-Image (apps/web/Dockerfile).
  output: "standalone",
};

export default nextConfig;
