import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/api-error";
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

export async function GET() {
  if (!(await requireAdmin())) {
    return fail("not_allowed", 403);
  }
  return NextResponse.json(snapshot());
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return fail("not_allowed", 403);

  let body: { id?: string; action?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return fail("bad_json", 400);
  }

  if (!body.id) return fail("missing_field", 400, { field: "id" });

  try {
    if (oidcConfigured() && (body.action === "reset-link" || body.action === "password")) {
      return fail("not_allowed", 403);
    }

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
