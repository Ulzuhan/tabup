import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { accountSessionUrl, enrollUrl, oidcConfigured } from "@/lib/oidc";
import { LOCALE_COOKIE, isLocale, localeFromHeader } from "@/i18n/config";
import { Landing } from "@/components/landing";
import { TripsView } from "./trips-view";

/**
 * The front door.
 *
 * Decided on the server: a stranger gets the landing page with no client JavaScript at
 * all, and somebody signed in goes straight to their trips. When linked with `?sso=1`
 * from the hub with OIDC active, bounce straight into sign-in (or clear the query if a
 * local session already exists) so there is no landing flash.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ sso?: string }>;
}) {
  const user = await getCurrentUser();
  const { sso } = await searchParams;
  if (sso === "1") {
    if (user) redirect("/");
    if (oidcConfigured()) redirect("/api/auth/oidc");
  }
  if (user) return <TripsView />;

  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored)
    ? stored
    : localeFromHeader((await headers()).get("accept-language"));

  return (
    <Landing
      locale={locale}
      enrollUrl={oidcConfigured() ? enrollUrl() : "/login?new=1"}
      accountSessionUrl={oidcConfigured() ? accountSessionUrl() : null}
    />
  );
}
