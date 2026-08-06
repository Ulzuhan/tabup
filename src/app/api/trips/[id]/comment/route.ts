import { NextRequest, NextResponse } from "next/server";
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
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  let body: { expenseId?: string; body?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.expenseId !== "string" || typeof body.body !== "string") {
    return NextResponse.json({ error: "expenseId and body required" }, { status: 400 });
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
      return NextResponse.json({ error: "Nothing to say, or no such expense" }, { status: 400 });
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
    return NextResponse.json({ error: "Could not save that" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeTrip(id, "write");
  if (!auth.ok) return auth.response;

  let body: { commentId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.commentId !== "string") {
    return NextResponse.json({ error: "commentId required" }, { status: 400 });
  }

  const result = deleteComment(id, body.commentId, {
    id: auth.user?.id,
    isOwner: auth.level === "owner",
  });
  if (result === "missing") {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }
  if (result === "forbidden") {
    return NextResponse.json(
      { error: "Only whoever wrote it, or the trip owner, can delete it" },
      { status: 403 }
    );
  }
  return NextResponse.json({ success: true });
}
