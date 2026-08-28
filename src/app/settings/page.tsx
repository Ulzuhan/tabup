import { redirect } from "next/navigation";
import { getCurrentUser, publicUser } from "@/lib/auth";
import { accountUrl, oidcConfigured } from "@/lib/oidc";
import { SettingsForm } from "./settings-form";

/**
 * Los ajustes de la cuenta: quién eres para el resto, y de qué te enteras.
 *
 * Existe porque el desplegable de la cabecera se había quedado pequeño. Cuando lo único
 * que había era el idioma, el aspecto y salir, un menú bastaba; en cuanto entran el
 * nombre con el que te ven los demás, tu cara, la moneda con la que abres un grupo, cómo
 * te pagan y qué avisos quieres, un menú de nueve líneas es una lista de cosas que no se
 * pueden explicar. Aquí cada ajuste puede llevar al lado por qué existe y a quién afecta
 * —que en una aplicación compartida no es un detalle: la mitad de esto lo ve otra
 * gente—, y el menú se queda en las cuatro líneas que de verdad son navegación.
 *
 * Se resuelve en el servidor: si no hay sesión no hay nada que enseñar, y el formulario
 * arranca con los valores puestos en vez de con un esqueleto.
 */
export const metadata = { title: "TabUp" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  // A la entrada, que con proveedor de identidad sabe adónde mandar. `next` trae de
  // vuelta aquí, que es lo que esperaba quien pulsó "Ajustes" y se encontró fuera.
  if (!user) redirect(`/login?next=${encodeURIComponent("/settings")}`);

  return (
    <SettingsForm
      user={publicUser(user)}
      accountUrl={accountUrl()}
      providerAccounts={oidcConfigured()}
    />
  );
}
