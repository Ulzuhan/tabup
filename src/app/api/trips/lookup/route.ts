import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, trips, members, expenses } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { accessLevel, canRead, isValidId } from "@/lib/store";

/**
 * Resolves a list of trip ids the browser remembers into summaries.
 *
 * A POST rather than a GET because the id list can be long, and these ids are the
 * access token for anonymous trips — keeping them out of URLs keeps them out of logs
 * and out of the Referer header.
 *
 * Ids the caller cannot read are dropped silently, so this cannot be used to test
 * whether a trip exists.
 */
export async function POST(request: NextRequest) {
  let body: { ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.ids)) {
    return NextResponse.json({ error: "ids must be an array" }, { status: 400 });
  }

  const user = await getCurrentUser();
  const ids = body.ids
    .filter((id): id is string => typeof id === "string" && isValidId(id))
    .slice(0, 50);

  const found = [];
  for (const id of ids) {
    if (!canRead(accessLevel(id, user?.id))) continue;

    const trip = db.select().from(trips).where(eq(trips.id, id)).get();
    if (!trip) continue;

    found.push({
      id: trip.id,
      name: trip.name,
      currency: trip.currency,
      createdAt: trip.createdAt,
      memberCount: db.select().from(members).where(eq(members.tripId, id)).all().length,
      expenseCount: db.select().from(expenses).where(eq(expenses.tripId, id)).all().length,
      owned: trip.ownerId !== null && trip.ownerId === user?.id,
      anonymous: trip.ownerId === null,
    });
  }

  return NextResponse.json({ trips: found });
}
