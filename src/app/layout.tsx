import { KaiCorpFooter } from "@/components/kaicorp-footer";
import { KaiCorpHeader } from "@/components/kaicorp-header";
import { AccountMenu } from "@/components/account-menu";
import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegistrar } from "@/components/offline";
import { cookies } from "next/headers";
import { I18nProvider } from "@/i18n/provider";
import { resolveLocale } from "@/i18n/server";
import { ThemeSync } from "@/components/theme";
import { THEME_COOKIE, isTheme } from "@/lib/theme";
import { getCurrentUser, isAdmin, pendingUsers, publicUser } from "@/lib/auth";
import { startHousekeeping } from "@/lib/housekeeping";
import { accountUrl } from "@/lib/oidc";
import "./globals.css";

const display = Space_Grotesk({ variable: "--font-display", weight: ["500", "700"], subsets: ["latin"] });
const sans = Inter({ variable: "--font-sans", weight: ["400", "500"], subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono", weight: ["400", "500"], subsets: ["latin"] });

/**
 * The public origin, for canonical and social previews.
 *
 * It comes from TABUP_PUBLIC_HOST, which already exists for the origin check:
 * no new variable, and whoever deploys this on their own domain gets their own
 * canonical without touching code. Unset, none is emitted — Next would resolve
 * relative URLs against localhost, and a canonical pointing there is worse than
 * no canonical at all.
 */
const publicHost = process.env.TABUP_PUBLIC_HOST?.trim();
const base = publicHost ? new URL(`https://${publicHost}`) : undefined;

const TITLE = "TabUp — shared expenses, settled";
const DESCRIPTION =
  "Track what a group spends across currencies and get the fewest payments that make everyone even. Self-hosted and open source, with no fintech upsell.";

export const metadata: Metadata = {
  ...(base ? { metadataBase: base, alternates: { canonical: "/" } } : {}),
  title: TITLE,
  description: DESCRIPTION,
  appleWebApp: { capable: true, title: "TabUp", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon-192.png", apple: "/apple-icon.png" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    siteName: "TabUp",
    // en_US, no es_ES: la interfaz y todo este texto están en inglés, y
    // declarar un idioma que no es el del contenido confunde a quien lo lea.
    locale: "en_US",
    ...(base ? { url: "/", images: [{ url: "/og.jpg", width: 760, height: 475, alt: "TabUp: balances between three people and how to settle them" }] } : {}),
  },
  twitter: { card: "summary_large_image" },
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
 * The theme, resolved on the server for the same reason as the language: the first paint
 * has to be the right one. No cookie means "whatever the device says", which the CSS
 * already handles on its own.
 */
async function resolveTheme() {
  const stored = (await cookies()).get(THEME_COOKIE)?.value;
  return isTheme(stored) ? stored : undefined;
}

/**
 * Quién está dentro, resuelto aquí para que la cabecera salga ya con su nombre.
 * Es la misma consulta que hacía `/api/auth/me` desde el navegador, un paso antes.
 */
async function resolveSession() {
  const user = await getCurrentUser();
  // La página de la cuenta en el proveedor, si quien despliega la publica: es una de
  // las cuatro líneas del menú, y sin ella simplemente no aparece.
  const cuenta = accountUrl();
  if (!user) return { user: null, pendingApprovals: 0, accountUrl: cuenta };
  const admin = isAdmin(user);
  return {
    user: { ...publicUser(user), admin },
    pendingApprovals: admin ? pendingUsers().length : 0,
    accountUrl: cuenta,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (process.env.NEXT_PHASE !== "phase-production-build") startHousekeeping();

  const [locale, theme, session] = await Promise.all([
    resolveLocale(),
    resolveTheme(),
    resolveSession(),
  ]);

  return (
    <html
      lang={locale}
      data-theme={theme}
      // `kc-light` viste de claro la cabecera y el pie de marca. Lo pone el
      // servidor cuando la elección es explícita; con "system" lo decide
      // `ThemeSync` en el navegador, igual que hace con `dark`.
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased${
        theme === "light" ? " kc-light" : ""
      }`}
    >
      <body className="brand-glow flex min-h-full flex-col bg-background text-foreground">
        <I18nProvider locale={locale}>
          <KaiCorpHeader app="TabUp">
            <AccountMenu
              user={session.user}
              pendingApprovals={session.pendingApprovals}
              accountUrl={session.accountUrl}
            />
          </KaiCorpHeader>
          {children}
          <KaiCorpFooter current="tabup" />
          <Toaster position="top-center" />
          <ServiceWorkerRegistrar />
          <ThemeSync />
        </I18nProvider>
      </body>
    </html>
  );
}
