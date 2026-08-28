import Link from "next/link";
import { Compass } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { enrollUrl, oidcConfigured } from "@/lib/oidc";
import { readInvite } from "@/lib/store";
import { MESSAGES } from "@/i18n/messages";
import { resolveLocale } from "@/i18n/server";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";
import { JoinButton, LocalJoinForm } from "./join-client";

/**
 * Dónde aterriza un enlace de invitación.
 *
 * Se decide EN EL SERVIDOR, y ese es el arreglo. Antes era una página de cliente que
 * pintaba siempre el formulario de correo y contraseña y lo mandaba a
 * `/api/auth/register` — rutas que, con un proveedor de identidad configurado,
 * devuelven 404 a propósito. Es decir: con proveedor, a quien recibía una invitación
 * y no tenía sesión abierta se le ofrecía la única puerta que no existe. La entrada
 * (`/login`) sí se enteró del cambio de era y redirige al proveedor; esta se quedó en
 * la de las cuentas locales, y es la razón por la que nadie ha entrado nunca en un
 * grupo ajeno.
 *
 * Ahora el servidor sabe qué clase de instancia es y ofrece lo que de verdad
 * funciona:
 *
 *   con sesión      un botón: unirse al grupo.
 *   con proveedor   entrar en el proveedor volviendo aquí, y —si la instancia lo
 *                   publica— dónde pedir una cuenta.
 *   sin proveedor   el formulario de siempre, que en ese modo sí funciona: una
 *                   invitación válida es permiso para registrarse.
 *
 * De paso el nombre del grupo llega ya en el HTML, sin el parpadeo de esqueleto que
 * daba pedirlo por `fetch` después de cargar.
 */

/** No se cachea nada: depende de la sesión y de una invitación que caduca. */
export const dynamic = "force-dynamic";

/** Sustituye `{trip}` y `{name}`. Es lo que hace el `t()` del cliente, y aquí no hay cliente. */
function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const locale = await resolveLocale();
  const t = MESSAGES[locale].join;

  // Una invitación caducada se trata como si nunca hubiera existido, igual que en la
  // API: quien tiene el enlace no averigua por la respuesta si el grupo existe.
  const invite = readInvite(token);
  if (!invite) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-secondary">
            <Compass className="size-6 text-muted-foreground" />
          </div>
          <h1 className="text-lg font-medium">{t.expired}</h1>
          <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">{t.expiredHint}</p>
          <Button
            variant="outline"
            className="mt-6"
            render={<Link href="/">{MESSAGES[locale].trip.goHome}</Link>}
          />
        </div>
      </div>
    );
  }

  const user = await getCurrentUser();
  const provider = oidcConfigured();
  // Sin `TABUP_ENROLL_URL` no hay botón de alta: mandar a alguien al formulario de
  // registro de un proveedor que no tiene autoservicio es otro callejón sin salida.
  const enroll = provider ? enrollUrl() : null;

  const vars = { trip: invite.tripName, name: invite.memberName ?? "" };
  const subtitle = user
    ? fill(invite.memberName ? t.subtitleInSeat : t.subtitleIn, vars)
    : fill(invite.memberName ? t.subtitleSeat : t.subtitle, vars);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <div className="mb-7 text-center">
        <p className="text-2xl font-semibold tracking-tight">
          <Wordmark />
        </p>
        <h1 className="mt-4 text-lg font-medium">{t.title}</h1>
        {/* Cuando el enlace se hizo para una persona, decir de quién es el sitio: la
            metieron en el reparto antes de que tuviera cuenta, y caer directamente en
            su columna es el sentido de invitar por correo. */}
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>

      {user ? (
        <JoinButton token={token} userName={user.name} />
      ) : provider ? (
        <>
          {/* Un enlace, no un formulario: la sesión la abre el proveedor y `next`
              trae de vuelta a esta misma invitación, ya con sesión. */}
          <Button
            className="h-11 w-full"
            render={
              <a href={`/api/auth/oidc?next=${encodeURIComponent(`/join/${token}`)}`}>
                {t.signInToJoin}
              </a>
            }
          />
          {enroll && (
            <>
              <Button
                variant="outline"
                className="mt-3 h-11 w-full"
                render={<a href={enroll}>{t.askAccount}</a>}
              />
              <p className="mt-3 text-center text-xs text-muted-foreground">
                {t.askAccountHint}
              </p>
            </>
          )}
        </>
      ) : (
        <LocalJoinForm token={token} />
      )}
    </main>
  );
}
