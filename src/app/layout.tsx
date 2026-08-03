import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegistrar } from "@/components/offline";
import { cookies, headers } from "next/headers";
import { I18nProvider } from "@/i18n/provider";
import { LOCALE_COOKIE, isLocale, localeFromHeader } from "@/i18n/config";
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

/**
 * Resolves the language on the server so the first paint is already translated and
 * `lang` is correct — an explicit choice in the cookie wins, otherwise the browser's
 * Accept-Language decides.
 */
async function resolveLocale() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(stored)) return stored;
  return localeFromHeader((await headers()).get("accept-language"));
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await resolveLocale();

  return (
    <html
      lang={locale}
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="brand-glow flex min-h-full flex-col bg-background text-foreground">
        <I18nProvider locale={locale}>
          {children}
          <Toaster position="top-center" />
          <ServiceWorkerRegistrar />
        </I18nProvider>
      </body>
    </html>
  );
}
