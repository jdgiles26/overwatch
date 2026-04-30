/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
    // Don't try to bundle native binaries on server.
    if (isServer) {
      config.externals = config.externals || [];
      if (Array.isArray(config.externals)) {
        config.externals.push("@huggingface/transformers", "onnxruntime-node");
      }
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
