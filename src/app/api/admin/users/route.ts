import { NextRequest, NextResponse } from "next/server";
import { approveUser, getCurrentUser, isAdmin, pendingUsers, rejectUser } from "@/lib/auth";

/**
 * Account requests, for the admin.
 *
 * Every handler re-checks the role rather than trusting that the UI hid the page: the
 * only thing standing between a normal account and approving itself is this check.
 */
async function requireAdmin() {
  const user = await getCurrentUser();
  return isAdmin(user) ? user : null;
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  return NextResponse.json({ pending: pendingUsers() });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  let body: { id?: string; action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const done = body.action === "reject" ? rejectUser(body.id) : approveUser(body.id);
  if (!done) {
    return NextResponse.json({ error: "No pending request with that id" }, { status: 404 });
  }

  return NextResponse.json({ pending: pendingUsers() });
}
