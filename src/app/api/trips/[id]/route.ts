import { NextRequest, NextResponse } from "next/server";
import {
  addMember,
  calculateBalances,
  calculateSettlements,
  deleteTrip,
  getTrip,
  listCollaborators,
  removeMembers,
  updateTripMeta,
} from "@/lib/store";
import { authorizeTrip } from "@/lib/authorize";
import { EMOJIS } from "@/lib/types";
import { logError } from "@/lib/errors";

// GET — trip with balances and the minimal set of settlements
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/trips/[id]">) {
  const { id } = await ctx.params;
  const auth = await authorizeTrip(id, "read");
  if (!auth.ok) return auth.response;

  const trip = await getTrip(id);
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const balances = calculateBalances(trip);
  const settlements = calculateSettlements(trip);

  // Names and emojis are attached here so the UI does not have to cross-reference.
  const enrichedBalances = balances.map((b) => {
    const member = trip.members.find((m) => m.id === b.memberId);
    return { ...b, name: member?.name, emoji: member?.emoji };
  });

  const enrichedSettlements = settlements.map((s) => {
    const fromMember = trip.members.find((m) => m.id === s.from);
    const toMember = trip.members.find((m) => m.id === s.to);
    return {
      ...s,
      fromName: fromMember?.name,
      fromEmoji: fromMember?.emoji,
      toName: toMember?.name,
      toEmoji: toMember?.emoji,
    };
  });

  const totalExpenses = trip.expenses.reduce((sum, e) => sum + e.amountBase, 0);

  return NextResponse.json({
    ...trip,
    balances: enrichedBalances,
    settlements: enrichedSettlements,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    // The UI hides the write controls on a read-only trip; the server refuses them
    // regardless, this only avoids showing buttons that would fail.
    access: auth.level,
    collaborators: listCollaborators(id),
  });
}

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/trips/[id]">) {
  const { id } = await ctx.params;
  const auth = await authorizeTrip(id, "own");
  if (!auth.ok) return auth.response;

  const deleted = await deleteTrip(id);
  if (!deleted) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}

// PATCH — rename the trip, add members or remove them
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/trips/[id]">) {
  const { id } = await ctx.params;
  const auth = await authorizeTrip(id, "write");
  if (!auth.ok) return auth.response;

  const trip = await getTrip(id);
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  try {
    const body = await request.json();

    if (body.addMembers && Array.isArray(body.addMembers)) {
      const names = body.addMembers.filter(
        (n: unknown): n is string =>
          typeof n === "string" && n.trim().length > 0 && n.trim().length <= 50
      );
      if (names.length === 0) {
        return NextResponse.json(
          { error: "addMembers must contain non-empty strings" },
          { status: 400 }
        );
      }

      const existingNames = trip.members.map((m) => m.name.toLowerCase());
      const duplicates = names.filter((n: string) =>
        existingNames.includes(n.trim().toLowerCase())
      );
      if (duplicates.length > 0) {
        return NextResponse.json(
          { error: `Duplicate member name(s): ${duplicates.join(", ")}` },
          { status: 400 }
        );
      }

      for (let i = 0; i < names.length; i++) {
        await addMember(
          id,
          names[i].trim(),
          EMOJIS[(trip.members.length + i) % EMOJIS.length]
        );
      }
    }

    if (body.name && typeof body.name === "string" && body.name.trim().length > 0) {
      await updateTripMeta(id, { name: body.name.trim().slice(0, 100) });
    }

    // null clears it; a number sets it. Absent leaves it alone, so a rename does not
    // wipe the budget as a side effect.
    if (body.budget !== undefined) {
      const parsed = body.budget === null ? null : Number(body.budget);
      if (parsed !== null && (!isFinite(parsed) || parsed <= 0 || parsed > 1e9)) {
        return NextResponse.json(
          { error: "Budget must be a positive number up to 1 billion" },
          { status: 400 }
        );
      }
      await updateTripMeta(id, { budget: parsed });
    }

    if (body.removeMembers && Array.isArray(body.removeMembers)) {
      // Their expenses, payments and share rows go with them (ON DELETE CASCADE).
      await removeMembers(id, body.removeMembers as string[]);
    }

    const updated = await getTrip(id);
    return NextResponse.json({ members: updated?.members ?? [] });
  } catch (error) {
    logError("PATCH /api/trips/[id]", error);
    return NextResponse.json({ error: "Failed to update trip" }, { status: 500 });
  }
}
