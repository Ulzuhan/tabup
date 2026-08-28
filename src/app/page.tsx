import { cookies, headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { enrollUrl, oidcConfigured } from "@/lib/oidc";
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

  // Sin proveedor, "crear cuenta" va al formulario propio: mandar a alguien al
  // flujo de alta de un Authentik que no existe es un callejón sin salida.
  //
  // Con proveedor, la dirección la pone quien despliega (`TABUP_ENROLL_URL`) y sin
  // ella no hay botón. Antes caía en un valor por defecto que era nuestro Authentik,
  // así que cualquier otra instancia mandaba a sus visitantes a pedir cuenta en casa
  // ajena.
  return (
    <Landing locale={locale} enrollUrl={oidcConfigured() ? enrollUrl() : "/login?new=1"} />
  );
}
