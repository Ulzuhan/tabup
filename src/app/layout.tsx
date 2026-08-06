import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegistrar } from "@/components/offline";
import { cookies, headers } from "next/headers";
import { I18nProvider } from "@/i18n/provider";
import { LOCALE_COOKIE, isLocale, localeFromHeader } from "@/i18n/config";
import { ThemeSync } from "@/components/theme";
import { THEME_COOKIE, isTheme } from "@/lib/theme";
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
  // One per scheme, so the browser chrome matches the page instead of leaving a dark bar
  // above a light app. An explicit choice that disagrees with the device is the one case
  // this cannot follow; a slightly wrong tint on the status bar is the whole cost.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfd" },
    { media: "(prefers-color-scheme: dark)", color: "#141520" },
  ],
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

/**
 * The theme, resolved on the server for the same reason as the language: the first paint
 * has to be the right one. No cookie means "whatever the device says", which the CSS
 * already handles on its own.
 */
async function resolveTheme() {
  const stored = (await cookies()).get(THEME_COOKIE)?.value;
  return isTheme(stored) ? stored : undefined;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, theme] = await Promise.all([resolveLocale(), resolveTheme()]);

  return (
    <html
      lang={locale}
      data-theme={theme}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="brand-glow flex min-h-full flex-col bg-background text-foreground">
        <I18nProvider locale={locale}>
          {children}
          <Toaster position="top-center" />
          <ServiceWorkerRegistrar />
          <ThemeSync />
        </I18nProvider>
      </body>
    </html>
  );
}
