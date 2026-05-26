import type { Metadata } from "next";
import "./globals.css";
import DemoGuide from "@/components/DemoGuide";
import CookieConsent from "@/components/CookieConsent";
import { siteUrl } from "@/lib/site-url";

const DEFAULT_TITLE = "PartsPort | The Industrial Parts Marketplace";
const DEFAULT_DESC =
  "PartsPort is the search engine for industrial parts and equipment. Type what you need, compare vetted-supplier options with real delivery ETAs, and order. We handle payment and delivery.";
const OG_IMAGE = "/og-default.svg";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl("/")),
  title: { default: DEFAULT_TITLE, template: "%s | PartsPort" },
  description: DEFAULT_DESC,
  icons: { icon: "/favicon.svg" },
  manifest: "/manifest.json",
  alternates: { canonical: "/" },
  openGraph: {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESC,
    type: "website",
    url: siteUrl("/"),
    siteName: "PartsPort",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "PartsPort" }],
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESC,
    images: [OG_IMAGE],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#f3f2ef" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          rel="preconnect"
          href="https://public.blob.vercel-storage.com"
          crossOrigin=""
        />
        <link
          rel="dns-prefetch"
          href="https://public.blob.vercel-storage.com"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        {children}
        <CookieConsent />
        {process.env.VERCEL_ENV !== "production" && <DemoGuide />}
      </body>
    </html>
  );
}
