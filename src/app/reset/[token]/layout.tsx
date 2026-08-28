import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { oidcConfigured } from "@/lib/oidc";

/**
 * Never in a search index: A password-reset token in the path is a way into an account.
 * `robots.txt` disallows this prefix as well — two layers, because a crawler
 * that indexes one of these publishes something private.
 *
 * It lives in a layout because the page itself is a client component, and those
 * cannot export metadata.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Con un proveedor de identidad esta pantalla no existe.
 *
 * `/api/auth/reset` ya devolvía 404 con proveedor, y desde ahora tampoco se pueden
 * crear enlaces de recuperación desde el panel: la contraseña es cosa del proveedor.
 * Lo que quedaba era la página, que habría pedido una contraseña nueva para
 * mandarla a una ruta que contesta 404 — el mismo callejón sin salida que la
 * página de invitación. Se manda a la entrada, que es quien sabe dónde está el
 * proveedor.
 */
export default function ResetLayout({ children }: { children: React.ReactNode }) {
  if (oidcConfigured()) redirect("/login");
  return children;
}
