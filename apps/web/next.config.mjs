import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the workspace root so Next.js doesn't auto-select a stray
  // lockfile from $HOME and break module resolution for dynamic chunks
  // (Cesium / @huggingface/transformers). Required after Next 15.5.x.
  outputFileTracingRoot: resolve(__dirname, "../.."),
  serverExternalPackages: [
    "@huggingface/transformers",
    "onnxruntime-node",
    "sharp",
  ],
  experimental: {
    serverActions: { allowedOrigins: ["*"] },
  },
  webpack: (config, { isServer }) => {
    config.resolve = config.resolve ?? {};
    config.externals = config.externals || [];
    if (!Array.isArray(config.externals)) {
      config.externals = [config.externals];
    }
    if (isServer) {
      // Don't try to bundle native binaries on server.
      config.externals.push("@huggingface/transformers", "onnxruntime-node");
      // Cesium is browser-only; never let SSR try to load it.
      config.externals.push("cesium");
    } else {
      // Stub Node-only packages for the browser bundle.
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        "onnxruntime-node": false,
        sharp: false,
        fs: false,
        path: false,
        crypto: false,
      };
      // Cesium 1.140's bundled chunks embed draco/ktx2 WebAssembly as
      // template literals containing `\00` (legacy octal escape), which
      // V8 refuses to parse — "Octal escape sequences are not allowed
      // in template strings." The Cesium release UMD is mirrored to
      // apps/web/public/cesium/Cesium.js by scripts/copy-cesium-assets.mjs
      // and loaded as a global via a <Script id="cesium-umd"
      // strategy="beforeInteractive"> in app/layout.tsx. The full UMD
      // form below makes webpack resolve `import "cesium"` (static or
      // dynamic) to the `Cesium` global regardless of the module
      // system the consumer uses.
      config.externals.push({
        cesium: {
          root: "Cesium",
          commonjs: "Cesium",
          commonjs2: "Cesium",
          amd: "Cesium",
        },
      });
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
  async rewrites() {
    const fabric = process.env.FABRIC_URL || "http://localhost:4311";
    return [{ source: "/fabric/:path*", destination: `${fabric}/:path*` }];
  },
};
export default nextConfig;
