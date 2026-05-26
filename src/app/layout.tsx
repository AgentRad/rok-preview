import type { Metadata } from "next";
import { Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import DeferredChrome from "@/components/DeferredChrome";
import { siteUrl } from "@/lib/site-url";

// P11.10: trimmed from 5 weights x 2 styles to 4 weights x 1 style. 300 is
// kept for the hero h1 (font-weight: 300). 700 is kept for invoice/freight
// labels. 200 and 800 had one CSS rule each; browser falls back to the
// nearest available weight (300/700) with no visible difference at the
// sizes those rules use (large display numerals). Italic was a single
// invoice "Thank you for your order" rule; browser-synthesised oblique is
// indistinguishable at 14px steel.
const hankenGrotesk = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  style: ["normal"],
  display: "swap",
  preload: true,
  variable: "--font-hanken",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  preload: false,
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
    <html
      lang="en"
      className={`${hankenGrotesk.variable} ${ibmPlexMono.variable} ${hankenGrotesk.className}`}
    >
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
        <a href="#main" className="skip-link">Skip to main content</a>
        {children}
        <DeferredChrome showDemoGuide={process.env.VERCEL_ENV !== "production"} />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
