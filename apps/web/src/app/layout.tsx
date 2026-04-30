import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OverWatch — Real-Time Situational Awareness",
  description:
    "OSINT, IoT, and CV fabric with 3D globe, WebGPU AI analyst, and autonomous browser agent.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
