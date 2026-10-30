import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run: a self-contained server (node server.js) in the container.
  output: "standalone",
  devIndicators: false,
  // Native addons and Google clients that read files at runtime (protos, binaries): loaded with Node's
  // require, never bundled, so the standalone output keeps their package files.
  serverExternalPackages: ["@contentauth/c2pa-node", "onnxruntime-node", "sharp", "firebase-admin", "@google-cloud/kms", "@google-cloud/storage", "google-gax"],
  // The face matcher's ONNX runtime links a shared library the tracer doesn't follow; ship the Linux
  // x64 folder (Cloud Run) and leave out the other platforms.
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v*/linux/x64/**/*"],
  },
  outputFileTracingExcludes: {
    "*": [
      "./node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v*/darwin/**/*",
      "./node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v*/win32/**/*",
      "./node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v*/linux/arm64/**/*",
      "./.models/**/*",
    ],
  },
};

export default nextConfig;
