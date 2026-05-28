import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { ConsoleFilter } from "@/components/ConsoleFilter";
import { PwaRegister } from "@/components/PwaRegister";
import { ToastContainer } from "@/components/ToastContainer";
import { ErrorBanner } from "@/components/ErrorBanner";

export const metadata: Metadata = {
  title: "OverWatch — Real-Time Situational Awareness",
  description:
    "OSINT, IoT, and CV fabric with 3D globe, WebGPU AI analyst, and autonomous browser agent.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0b1e1e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Cesium 1.140's webpack chunks contain template literals with
            `\00` legacy octal escapes that V8 refuses to parse. We load
            the Cesium UMD release here and treat `import "cesium"` as
            the `Cesium` global via webpack externals (see next.config.mjs).
            Asset is mirrored from node_modules by scripts/copy-cesium-assets.mjs. */}
        <Script
          src="/cesium/Cesium.js"
          strategy="beforeInteractive"
          id="cesium-umd"
        />
      </head>
      <body className="min-h-screen antialiased">
        <ConsoleFilter />
        <PwaRegister />
        {children}
        <ErrorBanner />
        <ToastContainer />
      </body>
    </html>
  );
}
