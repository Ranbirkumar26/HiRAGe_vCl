import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // unpdf ships a pdf.js build that must not be bundled into the server chunk;
  // mammoth reaches for node builtins the bundler cannot statically resolve.
  serverExternalPackages: ["unpdf", "mammoth"],
  experimental: {
    // Bulk resume uploads arrive as one Server Action payload, which is buffered
    // in memory. 50 MB is a batch of roughly 200 typical resumes; the job detail
    // page tells admins to upload larger pools in batches.
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
