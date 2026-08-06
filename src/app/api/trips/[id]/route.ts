import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import {
  accessLevel,
  addMember,
  authoredBy,
  calculateBalances,
  calculateSettlements,
  createInvite,
  deleteTrip,
  getTrip,
  grantAccess,
  memberEmails,
  memberForUser,
  memberNameTaken,
  pendingInviteFor,
  removeMembers,
  renameMember,
  seatUser,
  unlinkedMembers,
  updateTripMeta,
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

  const isOwner = auth.level === "owner";
  // Everyone in a trip adds expenses, and each answers for what they added. Marked per
  // row here rather than left to the client to work out: the client would need to be
  // told who wrote every line to do it, which is more than it needs to know.
  const written = auth.user
    ? authoredBy(id, auth.user.id)
    : { expenses: new Set<string>(), payments: new Set<string>() };
  const mine = (set: Set<string>, rowId: string) => isOwner || set.has(rowId);

  // The address behind a seat is the owner's to see: they typed it in order to invite
  // the person. Nobody else on the trip needs it, so nobody else is given it.
  const emails = isOwner ? memberEmails(id) : {};

  return NextResponse.json({
    ...trip,
    members: trip.members.map((m) => ({ ...m, accountEmail: emails[m.id] })),
    expenses: trip.expenses.map((e) => ({ ...e, mine: mine(written.expenses, e.id) })),
    payments: trip.payments.map((p) => ({ ...p, mine: mine(written.payments, p.id) })),
    balances: enrichedBalances,
    settlements: enrichedSettlements,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    // The UI hides what this caller cannot do; the server refuses it regardless, this
    // only avoids showing buttons that would fail.
    access: auth.level,
    you: you?.id ?? null,
    // Offered rather than guessed: the names were typed by somebody else, and only the
    // person reading them knows which one is them. Empty once they have chosen — and
    // empty from the start for anyone who joined a trip with nothing free to claim,
    // since they were seated on the way in.
    unclaimed: you ? [] : unlinkedMembers(id),
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

/**
 * PATCH — the trip itself, and who is in it.
 *
 * All of it is the owner's, bar one thing: your own name. The trip belongs to whoever
 * made it, and everyone else in it is there to keep track of money, not to rename the
 * holiday or decide who else comes. The exception is the alias, because "what to call
 * me here" was never the owner's to decide.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/trips/[id]">) {
  const { id } = await ctx.params;
  const auth = await authorizeTrip(id, "read");
  if (!auth.ok) return auth.response;

  const trip = await getTrip(id);
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const ownerOnly = () =>
    NextResponse.json({ error: "Only the trip owner can change that" }, { status: 403 });
  const isOwner = auth.level === "owner";

  try {
    const body = await request.json();

    /**
     * Checked before anything is written, not as each branch is reached.
     *
     * A request carrying both an alias change and a budget used to apply the alias and
     * then answer 403 for the budget — an error over work that had already happened,
     * which is the one thing an error must never be. Whatever the body asks for, it
     * either all goes through or none of it does.
     */
    const OWNER_ONLY = ["addByEmail", "addMembers", "removeMembers", "name", "budget"] as const;
    if (!isOwner && OWNER_ONLY.some((key) => body[key] !== undefined)) return ownerOnly();

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
      const email = normalizeEmail(body.addByEmail);
      if (!isValidEmail(email)) {
        return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
      }

      const target = db.select().from(users).where(eq(users.email, email)).get();

      if (target) {
        const seat = memberForUser(id, target.id);

        // Somebody who was taken out keeps their seat, so inviting them back is exactly
        // that: they return to the column that already holds their money, rather than
        // getting a second one beside it. Having a seat is therefore not the question —
        // whether they can still open the trip is.
        if (seat && accessLevel(id, target.id) !== "none") {
          return NextResponse.json({ error: "They are already in this trip" }, { status: 409 });
        }

        await grantAccess(id, target.id);
        const member = seat ?? (await seatUser(id, target));
        if (!member) {
          return NextResponse.json({ error: "Could not add them" }, { status: 500 });
        }
        return NextResponse.json({ members: (await getTrip(id))?.members ?? [], invite: null });
      }

      // Already invited and not yet arrived: the same link again, and the seat that is
      // already waiting. Typing an address twice is what people do when they are not
      // sure the first one worked, and it should not cost them a duplicate column.
      const waiting = pendingInviteFor(id, email);
      if (waiting) {
        return NextResponse.json({
          members: trip.members,
          invite: { token: waiting.token, expiresAt: waiting.expiresAt },
        });
      }

      // Nobody holds that address yet, so the seat is made anyway and the invitation is
      // bound to it: accepting later lands them in the column that was kept for them
      // instead of leaving them outside the arithmetic. The part before the @ is a
      // starting point they can change once they are in.
      const proposed = email.split("@")[0];
      let name = proposed.slice(0, 50);
      for (let n = 2; memberNameTaken(id, name); n++) name = `${proposed.slice(0, 46)} ${n}`;

      const member = await addMember(id, name, EMOJIS[trip.members.length % EMOJIS.length]);
      if (!member) {
        return NextResponse.json({ error: "Could not add them" }, { status: 500 });
      }

      return NextResponse.json({
        members: (await getTrip(id))?.members ?? [],
        // The owner sends them this; their seat is already waiting under it.
        invite: await createInvite(id, member.id, email),
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
      if (!isMine && !(isOwner && isFree)) {
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

    let released = 0;
    if (body.removeMembers && Array.isArray(body.removeMembers)) {
      // Somebody still in the trip keeps their column and loses their access; anyone
      // else is deleted, and the cascade takes their expenses, the payments they were
      // part of and their share of everyone else's. See `removeMembers`, which refuses
      // the owner's own seat before writing anything rather than halfway through.
      const result = await removeMembers(id, body.removeMembers as string[]);
      released = result.released;
      if (result.refused) {
        return NextResponse.json(
          { error: "A trip cannot be left without its owner" },
          { status: 400 }
        );
      }
    }

    const updated = await getTrip(id);
    return NextResponse.json({
      members: updated?.members ?? [],
      // So the UI can say which of the two things happened: somebody stepped out of the
      // trip, or a name and its figures were deleted.
      released,
    });
  } catch (error) {
    logError("PATCH /api/trips/[id]", error);
    return NextResponse.json({ error: "Failed to update trip" }, { status: 500 });
  }
}
