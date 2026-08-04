import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { acknowledgeErrors, clearErrors, recentErrors } from "@/lib/errors";

/** Server failures, for the admin. Same role check as everything else under /api/admin. */
async function requireAdmin() {
  const user = await getCurrentUser();
  return isAdmin(user) ? user : null;
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  return NextResponse.json({ errors: recentErrors() });
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  let body: { action?: string; id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Dismissing keeps the row and marks it read, so a failure that comes back is visibly
  // a failure that came back. Clearing throws the history away and is the deliberate one.
  if (body.action === "clear") clearErrors();
  else acknowledgeErrors(body.id);

  return NextResponse.json({ errors: recentErrors() });
}
