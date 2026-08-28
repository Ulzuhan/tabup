import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/api-error";
import { jsonBody } from "@/lib/body";
import { eq } from "drizzle-orm";
import {
  approveUser,
  approvedUsers,
  createPasswordReset,
  getCurrentUser,
  isAdmin,
  passwordProblem,
  pendingUsers,
  rejectUser,
  setPassword,
} from "@/lib/auth";
import { db, users } from "@/db";
import { logError } from "@/lib/errors";
import { oidcConfigured } from "@/lib/oidc";

/**
 * Accounts, for the admin.
 *
 * Every handler re-checks the role rather than trusting that the UI hid the page: the
 * only thing standing between a normal account and approving itself is this check.
 */
async function requireAdmin() {
  const user = await getCurrentUser();
  return isAdmin(user) ? user : null;
}

const snapshot = () => ({ pending: pendingUsers(), users: approvedUsers() });

/**
 * Con un proveedor de identidad, aquí no se administran cuentas.
 *
 * Quién puede entrar, quién deja de poder y quién recupera su contraseña son
 * decisiones del proveedor, y esta era la última puerta por la que se podían tomar
 * desde dentro de TabUp: aprobar y rechazar seguían abiertos aunque el formulario de
 * registro llevara meses devolviendo 404. Una cuenta local aprobada aquí tampoco
 * podría entrar —el login también es 404 con proveedor—, así que lo único que hacía
 * era sostener una pantalla que decía administrar algo que no administra.
 *
 * 403 y no 404: la ruta existe, y quien la llama es el administrador. No hay nada
 * que ocultarle, solo un sitio distinto al que ir.
 */
const identityIsElsewhere = () => oidcConfigured();

export async function GET() {
  if (!(await requireAdmin())) {
    return fail("not_allowed", 403);
  }
  if (identityIsElsewhere()) return fail("not_allowed", 403);
  return NextResponse.json(snapshot());
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return fail("not_allowed", 403);
  if (identityIsElsewhere()) return fail("not_allowed", 403);

  // `null` es JSON válido: pasaba el catch y reventaba al leer un campo.
  const body: { id?: string; action?: string; password?: string } | null = await jsonBody(request);
  if (!body) return fail("bad_json", 400);

  if (!body.id) return fail("missing_field", 400, { field: "id" });

  try {
    /**
     * A link, rather than a password read out over the phone.
     *
     * The person asks the admin because there is no email here to ask a machine. What
     * comes back is single-use and dies within the hour, so what stays in that
     * conversation stops being a way into somebody's account.
     */
    if (body.action === "reset-link") {
      const target = db.select().from(users).where(eq(users.id, body.id)).get();
      if (!target) {
        return fail("not_found", 404);
      }
      const reset = createPasswordReset(target.id);
      return NextResponse.json({ ...reset, email: target.email });
    }

    if (body.action === "password") {
      const password = String(body.password ?? "");
      const problem = passwordProblem(password);
      if (problem) return fail(problem, 400);

      if (!(await setPassword(body.id, password))) {
        return fail("not_found", 404);
      }
      return NextResponse.json(snapshot());
    }

    const done = body.action === "reject" ? rejectUser(body.id) : approveUser(body.id);
    if (!done) {
      return fail("not_found", 404);
    }

    return NextResponse.json(snapshot());
  } catch (error) {
    logError("POST /api/admin/users", error);
    return fail("save_failed", 500);
  }
}
