import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/api-error";
import { jsonBody } from "@/lib/body";
import {
  addComment,
  deleteComment,
  getTrip,
  logActivity,
  memberForUser,
  readComments,
} from "@/lib/store";
import { authorizeTrip } from "@/lib/authorize";
import { notify, othersInTrip } from "@/lib/push";
import { logError } from "@/lib/errors";

/**
 * What people say about an expense, as opposed to what they do to it.
 *
 * This is the alternative to editing, and the reason it exists. Somebody who thinks a
 * figure is wrong has two ways to act: change it, which rewrites what another person
 * recorded about their own money, or say so. Only one of those needs permission — and an
 * app that offers only the first is one where people quietly overwrite each other, which
 * is the complaint Splitwise collects daily for having no permissions at all.
 *
 * Everyone in the trip can read and write them. A comment costs nobody anything and
 * gating it would defeat the point: the person who cannot edit is precisely the one who
 * needs a way to speak.
 */

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeTrip(id, "read");
  if (!auth.ok) return auth.response;

  const expenseId = request.nextUrl.searchParams.get("expenseId") ?? "";
  return NextResponse.json({
    comments: readComments(id, expenseId, {
      id: auth.user?.id,
      isOwner: auth.level === "owner",
    }),
  });
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeTrip(id, "write");
  if (!auth.ok) return auth.response;
  if (!auth.user) {
    return fail("signin_required", 401);
  }

  // `null` es JSON válido: pasaba el catch y reventaba al leer un campo.
  const body: { expenseId?: string; body?: string } | null = await jsonBody(request);
  if (!body) return fail("bad_json", 400);
  if (typeof body.expenseId !== "string" || typeof body.body !== "string") {
    return fail("missing_field", 400);
  }

  try {
    const comment = addComment({
      tripId: id,
      expenseId: body.expenseId,
      userId: auth.user.id,
      // What they are called in this trip, not on their account: a comment is read
      // alongside the names in the split, and "Papá said" has to match the column.
      authorName: memberForUser(id, auth.user.id)?.name ?? auth.user.name,
      body: body.body,
    });
    // Either the expense is not in this trip — which has to read as not existing, like
    // every other id arriving in a body — or the comment was empty.
    if (!comment) {
      return fail("nothing_to_say", 400);
    }

    logActivity(id, auth.user, "commentAdded", body.body.trim().slice(0, 60));
    const trip = await getTrip(id);
    notify(othersInTrip(id, auth.user.id), {
      action: "comment",
      trip: trip?.name ?? "",
      actor: comment.authorName,
      subject: trip?.expenses.find((e) => e.id === body.expenseId)?.description ?? "",
      url: `/trip/${id}`,
    });
    return NextResponse.json({ comment });
  } catch (error) {
    logError("POST /api/trips/[id]/comment", error);
    return fail("save_failed", 500);
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeTrip(id, "write");
  if (!auth.ok) return auth.response;

  // `null` es JSON válido: pasaba el catch y reventaba al leer un campo.
  const body: { commentId?: string } | null = await jsonBody(request);
  if (!body) return fail("bad_json", 400);
  if (typeof body.commentId !== "string") {
    return fail("missing_field", 400, { field: "commentId" });
  }

  const result = deleteComment(id, body.commentId, {
    id: auth.user?.id,
    isOwner: auth.level === "owner",
  });
  if (result === "missing") {
    return fail("not_found", 404);
  }
  if (result === "forbidden") {
    return fail("author_only", 403);
  }
  return NextResponse.json({ success: true });
}
