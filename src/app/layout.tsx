import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegistrar } from "@/components/offline";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TabUp — Shared Expense Tracker",
  description: "Split expenses with friends. See who owes whom. No account needed.",
  appleWebApp: { capable: true, title: "TabUp", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon-192.png", apple: "/apple-icon.png" },
  openGraph: {
    title: "TabUp — Shared Expense Tracker",
    description: "Split expenses with friends. See who owes whom. No account needed.",
    type: "website",
    locale: "es_ES",
  },
};

/**
 * `themeColor` paints the mobile browser chrome to match the app background, which is
 * what stops the white bar above the page on iOS. `viewportFit` lets content reach
 * under the notch while the safe-area padding below keeps it clear of the home bar.
 */
export const viewport: Viewport = {
  themeColor: "#141520",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="brand-glow flex min-h-full flex-col bg-background text-foreground">
        {children}
        <Toaster position="top-center" />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
