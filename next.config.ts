import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // undici is the engine behind Node's fetch; we use it only to bypass the
  // expired UAT certificate. Keep it out of the bundle — resolve at runtime.
  serverExternalPackages: ["undici", "sharp"],
};

export default nextConfig;
