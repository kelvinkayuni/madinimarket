import type { NextConfig } from "next";

const deploymentId = process.env.VERCEL_DEPLOYMENT_ID
  ?? process.env.NEXT_DEPLOYMENT_ID
  ?? process.env.VERCEL_GIT_COMMIT_SHA
  ?? "development";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.137.1"],
  deploymentId,
  env: {
    NEXT_PUBLIC_APP_VERSION: deploymentId,
  },
};

export default nextConfig;
