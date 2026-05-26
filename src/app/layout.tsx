import type { Metadata } from "next";
import { Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import DemoGuide from "@/components/DemoGuide";
import CookieConsent from "@/components/CookieConsent";
import { siteUrl } from "@/lib/site-url";

const hankenGrotesk = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-hanken",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-plex-mono",
});

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
    <html lang="en" className={`${hankenGrotesk.variable} ${ibmPlexMono.variable}`}>
      <head>
        <meta name="theme-color" content="#f3f2ef" />
        <link
          rel="preconnect"
          href="https://public.blob.vercel-storage.com"
          crossOrigin=""
        />
        <link
          rel="dns-prefetch"
          href="https://public.blob.vercel-storage.com"
        />
      </head>
      <body>
        {children}
        <CookieConsent />
        {process.env.VERCEL_ENV !== "production" && <DemoGuide />}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
