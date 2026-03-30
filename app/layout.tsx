import type { Metadata, Viewport } from "next";
import { MiniKitProvider } from "@worldcoin/minikit-js/minikit-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: "ProofCam Mini App Template",
  description:
    "World App Mini App template with device proof by default, Orb human proof option, camera capture, and local in-app photo storage.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f7f1e4",
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
