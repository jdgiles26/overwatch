import type { Metadata, Viewport } from "next";
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
