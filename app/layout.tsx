import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "UnityWall — A living wall, assembled by everyone in the room",
  description:
    "A shared photo wall for weddings and events. Scan a QR, drop a photo, watch the wall fill in.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "UnityWall",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/assets/unitywall-logo.jpeg",
    apple: "/assets/unitywall-logo.jpeg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FAF7F2",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400..700;1,400..600&family=Hanken+Grotesk:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <div id="stage" className="stage">
          <main id="app" className="app" aria-live="polite">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
