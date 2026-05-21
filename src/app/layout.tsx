import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PartsPort | The Industrial Parts Marketplace",
  description:
    "PartsPort is the simplest way to source industrial parts. Search what you need, compare vetted-supplier options, and we handle payment and delivery.",
  icons: { icon: "/favicon.svg" },
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#11161d" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
