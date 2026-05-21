import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://rok-preview.vercel.app"),
  title: {
    default: "PartsPort | The Industrial Parts Marketplace",
    template: "%s | PartsPort",
  },
  description:
    "PartsPort is the simplest way to source industrial parts. Search what you need, compare vetted-supplier options, and we handle payment and delivery.",
  icons: { icon: "/favicon.svg" },
  manifest: "/manifest.json",
  openGraph: {
    title: "PartsPort | The Industrial Parts Marketplace",
    description:
      "Source industrial parts as easily as online shopping. Vetted suppliers, transparent pricing, delivery handled end to end.",
    type: "website",
    siteName: "PartsPort",
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
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
