import { cookies, headers } from "next/headers";
import { getCurrentUser, registrationOpen } from "@/lib/auth";
import { LOCALE_COOKIE, isLocale, localeFromHeader } from "@/i18n/config";
import { Landing } from "@/components/landing";
import { TripsView } from "./trips-view";

/**
 * The front door.
 *
 * Decided on the server: a stranger gets the landing page with no client JavaScript at
 * all, and somebody signed in goes straight to their trips. Doing this in the browser
 * would mean everyone downloads the app shell first and watches it decide.
 */
export default async function Home() {
  const user = await getCurrentUser();
  if (user) return <TripsView />;

  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored)
    ? stored
    : localeFromHeader((await headers()).get("accept-language"));

  return <Landing locale={locale} canRegister={registrationOpen()} />;
}
