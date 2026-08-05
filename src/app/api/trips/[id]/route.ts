import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import {
  addMember,
  calculateBalances,
  calculateSettlements,
  createInvite,
  deleteTrip,
  getTrip,
  grantAccess,
  memberForUser,
  memberNameTaken,
  removeMembers,
  renameMember,
  unlinkedMembers,
  updateTripMeta,
  visibleCollaborators,
} from "@/lib/store";
import { db, users } from "@/db";
import { authorizeTrip } from "@/lib/authorize";
import { isValidEmail, normalizeEmail } from "@/lib/auth";
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

  // Which participant the caller is. Being able to open a trip and being one of the
  // people it splits between are different things, and the app was only modelling the
  // first — so it could never say "you owe", only "Andoni owes".
  const you = auth.user ? memberForUser(id, auth.user.id) : null;

  return NextResponse.json({
    ...trip,
    balances: enrichedBalances,
    settlements: enrichedSettlements,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    // The UI hides the write controls on a read-only trip; the server refuses them
    // regardless, this only avoids showing buttons that would fail.
    access: auth.level,
    you: you?.id ?? null,
    // Offered rather than guessed: the names were typed by somebody else, and only the
    // person reading them knows which one is them. Empty once they have chosen.
    unclaimed: you ? [] : unlinkedMembers(id),
    collaborators: visibleCollaborators(id, {
      id: auth.user?.id,
      isOwner: auth.level === "owner",
    }),
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

    /**
     * Adding somebody by email.
     *
     * The two halves of this used to live in separate lists that knew nothing of each
     * other: a member was a line of text, a collaborator was an email address, and the
     * same person appeared as both with no link between them — so the app could not
     * tell that the participant called "Andoni" was the account that had just signed
     * in. One action now does both: it seats them in the split *and* lets them in.
     *
     * If nobody holds that address yet, the seat is made anyway and the invitation is
     * bound to it, so accepting later lands them in the right column instead of
     * leaving them outside the arithmetic.
     */
    if (typeof body.addByEmail === "string") {
      if (auth.level !== "owner") {
        return NextResponse.json(
          { error: "Only the trip owner can invite people" },
          { status: 403 }
        );
      }

      const email = normalizeEmail(body.addByEmail);
      if (!isValidEmail(email)) {
        return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
      }

      const target = db.select().from(users).where(eq(users.email, email)).get();
      const role = body.role === "viewer" ? "viewer" : "editor";

      if (target && memberForUser(id, target.id)) {
        return NextResponse.json({ error: "They are already in this trip" }, { status: 409 });
      }

      // Their own account name, or the part before the @ as a starting point they can
      // change themselves once they are in.
      const proposed = target?.name ?? email.split("@")[0];
      let name = proposed.slice(0, 50);
      for (let n = 2; memberNameTaken(id, name); n++) name = `${proposed.slice(0, 46)} ${n}`;

      const member = await addMember(
        id,
        name,
        EMOJIS[trip.members.length % EMOJIS.length],
        target?.id
      );
      if (!member) {
        return NextResponse.json({ error: "Could not add them" }, { status: 500 });
      }

      if (target) await grantAccess(id, target.id, role);
      const invite = target ? null : await createInvite(id, role, member.id);

      return NextResponse.json({
        members: (await getTrip(id))?.members ?? [],
        // Present only when they have no account yet: the owner sends them this.
        invite,
        collaborators: visibleCollaborators(id, { id: auth.user?.id, isOwner: true }),
      });
    }

    /**
     * Adding somebody by name alone.
     *
     * Kept on purpose. Most people at a table will never register here — this instance
     * does not even take open sign-ups — and refusing to split a taxi four ways until
     * everyone has an account would be the wrong trade. A free member grants nobody
     * anything: it is a column of arithmetic with a label on it, and it can be claimed
     * by an account later.
     */
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

    /**
     * Renaming a participant — the alias.
     *
     * The same account is "Andoni" among friends and "Papá" in the family trip, and
     * neither is a lie: the link to the account carries who they are, the name is only
     * what to call them here. Your own is yours to set; the owner can label the free
     * members, since somebody typed those names in the first place.
     */
    if (body.renameMember && typeof body.renameMember === "object") {
      const { id: memberId, name } = body.renameMember as { id?: string; name?: string };
      if (typeof memberId !== "string" || typeof name !== "string" || !name.trim()) {
        return NextResponse.json({ error: "renameMember needs an id and a name" }, { status: 400 });
      }

      const target = trip.members.find((m) => m.id === memberId);
      if (!target) {
        return NextResponse.json({ error: "No such member" }, { status: 404 });
      }

      const isMine = Boolean(auth.user && target.userId === auth.user.id);
      const isFree = !target.userId;
      if (!isMine && !(auth.level === "owner" && isFree)) {
        return NextResponse.json(
          { error: "Only they can change that name" },
          { status: 403 }
        );
      }
      if (memberNameTaken(id, name, memberId)) {
        return NextResponse.json({ error: `Duplicate member name: ${name.trim()}` }, { status: 400 });
      }

      renameMember(id, memberId, name);
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
      // Their expenses, payments and share rows go with them (ON DELETE CASCADE), which
      // is why a participant tied to an account is the owner's to remove and nobody
      // else's: it is a person's money, not a mislabelled column.
      const { refused } = await removeMembers(id, body.removeMembers as string[], {
        allowLinked: auth.level === "owner",
      });
      if (refused > 0) {
        return NextResponse.json(
          { error: "Only the trip owner can remove someone with an account" },
          { status: 403 }
        );
      }
    }

    const updated = await getTrip(id);
    return NextResponse.json({
      members: updated?.members ?? [],
      collaborators: visibleCollaborators(id, {
        id: auth.user?.id,
        isOwner: auth.level === "owner",
      }),
    });
  } catch (error) {
    logError("PATCH /api/trips/[id]", error);
    return NextResponse.json({ error: "Failed to update trip" }, { status: 500 });
  }
}
