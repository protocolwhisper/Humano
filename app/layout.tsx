import type { Metadata, Viewport } from "next";
import { MiniKitProvider } from "@worldcoin/minikit-js/minikit-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: "Humano",
  description:
    "Humano is a proof-gated mini app feed for verified humans, with World ID access control, camera capture, and local in-app photo storage.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#050505",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <MiniKitProvider>{children}</MiniKitProvider>
      </body>
    </html>
  );
}
