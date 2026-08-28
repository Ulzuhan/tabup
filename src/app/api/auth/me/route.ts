import { NextRequest, NextResponse } from "next/server";
import {
  destroySession,
  getCurrentUser,
  isAdmin,
  pendingUsers,
  publicUser,
  registrationOpen,
  updateProfile,
  verifyPassword,
} from "@/lib/auth";
import { deleteAccount, FREE_TRIP_LIMIT, ownedTripCount } from "@/lib/store";
import { fail } from "@/lib/api-error";
import { jsonBody } from "@/lib/body";
import { logError } from "@/lib/errors";
import { oidcConfigured } from "@/lib/oidc";

/** Who is signed in, and how much of the free plan they have used. */
export async function GET() {
  const user = await getCurrentUser();
  // Reported so the sign-in screen can hide a path that would only end in a refusal.
  if (!user) return NextResponse.json({ user: null, registrationOpen: registrationOpen() });

  return NextResponse.json({
    user: { ...publicUser(user), admin: isAdmin(user) },
    // Surfaced here so the header can badge the menu without a second request.
    pendingApprovals: isAdmin(user) ? pendingUsers().length : 0,
    usage: {
      trips: ownedTripCount(user.id),
      // null means no cap, which is the default.
      tripLimit: user.plan === "free" ? FREE_TRIP_LIMIT : null,
    },
  });
}

/**
 * Cambiar el propio perfil: cómo te llamas, con qué cara te sientas, en qué moneda
 * abres un grupo, cómo te pagan y de qué quieres enterarte.
 *
 * Todo esto era del grupo o de nadie. El nombre lo ponía el proveedor y solo se podía
 * cambiar el alias dentro de cada grupo —cinco grupos, cinco veces—; la cara la repartía
 * el orden de llegada; la moneda venía fijada a euros en el formulario y un grupo no
 * puede cambiarla después; y los avisos eran un interruptor de todo o nada.
 *
 * Se manda solo lo que cambia: un campo ausente no se toca, que es lo que permite a la
 * página de ajustes guardar una sección sin arrastrar las demás.
 */
export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return fail("signin_required", 401);

  const cuerpo = await jsonBody(request);
  if (!cuerpo) return fail("bad_json", 400);

  const resultado = updateProfile(user.id, cuerpo);
  if (!resultado.ok) return fail(resultado.code, 400);

  return NextResponse.json({ user: publicUser(resultado.user) });
}

/**
 * Closing your own account.
 *
 * The password is asked for again, and it is not a formality: a session is whoever is
 * holding the phone, and an unlocked phone left on a table should not be enough to delete
 * somebody's spending for good. It is the same reason a bank asks twice.
 *
 * **Con un proveedor de identidad no hay contraseña que pedir**, y esto era un callejón
 * sin salida: la de una cuenta creada por OIDC es `oidc$<aleatorio>`, que `verifyPassword`
 * rechaza siempre por no ser un hash scrypt. O sea que cerrar la cuenta —lo único que
 * esta pantalla existe para poder hacer— era imposible para todo el que entra por el
 * proveedor, que con proveedor configurado son todos. Entonces se pide escribir la
 * dirección de la cuenta.
 *
 * Y hay que decir qué es y qué no: escribir tu propia dirección **confirma la intención,
 * no la identidad**. Quien tenga el teléfono desbloqueado la sabe. La credencial la
 * guarda el proveedor y comprobarla de verdad exigiría un viaje de ida y vuelta a él en
 * mitad del borrado; lo que esto impide es el toque accidental, que es contra lo que
 * protege una confirmación escrita.
 *
 * What happens to the trips is in `deleteAccount`. The short version, which the dialog
 * says out loud before anyone taps it: groups they run go to whoever else has been in them
 * longest, groups nobody else is in go with them, and the column of figures they left in
 * other people's groups stays exactly where it is.
 */
export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return fail("signin_required", 401);

  const cuerpo = await jsonBody(request);
  if (!cuerpo) return fail("bad_json", 400);
  const { password, confirm } = cuerpo;

  if (oidcConfigured()) {
    const typed = typeof confirm === "string" ? confirm.trim().toLowerCase() : "";
    if (typed !== user.email.toLowerCase()) {
      return fail("wrong_confirmation", 403);
    }
  } else if (typeof password !== "string" || !(await verifyPassword(password, user.passwordHash))) {
    return fail("wrong_credentials", 403);
  }

  try {
    const outcome = await deleteAccount(user.id);
    // The cookie goes too. The session row is already gone with the account, so this is
    // only about not leaving a dead token in the browser.
    await destroySession();
    return NextResponse.json({ ok: true, ...outcome });
  } catch (error) {
    logError("DELETE /api/auth/me", error);
    return fail("save_failed", 500);
  }
}
