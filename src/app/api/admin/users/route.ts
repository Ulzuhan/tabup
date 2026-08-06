import { NextRequest, NextResponse } from "next/server";
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
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  return NextResponse.json(snapshot());
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  let body: { id?: string; action?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

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
        return NextResponse.json({ error: "No account with that id" }, { status: 404 });
      }
      const reset = createPasswordReset(target.id);
      return NextResponse.json({ ...reset, email: target.email });
    }

    if (body.action === "password") {
      const password = String(body.password ?? "");
      const problem = passwordProblem(password);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });

      if (!(await setPassword(body.id, password))) {
        return NextResponse.json({ error: "No account with that id" }, { status: 404 });
      }
      return NextResponse.json(snapshot());
    }

    const done = body.action === "reject" ? rejectUser(body.id) : approveUser(body.id);
    if (!done) {
      return NextResponse.json({ error: "No pending request with that id" }, { status: 404 });
    }

    return NextResponse.json(snapshot());
  } catch (error) {
    logError("POST /api/admin/users", error);
    return NextResponse.json({ error: "Failed to update the account" }, { status: 500 });
  }
}
