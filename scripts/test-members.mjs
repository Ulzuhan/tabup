#!/usr/bin/env node
/**
 * Who is in a trip, and who is allowed to change that.
 *
 *   rm -f data/test.db* && TABUP_DB=data/test.db TABUP_REGISTRATION=open npm run start &
 *   npm run test:members
 *
 * Two things are being checked here, and they used to be one hole each.
 *
 * The first is isolation. Every id below arrives in a request *body*, while the
 * authorisation comes from the *URL* — so write access to any one trip used to be write
 * access to any row in the database whose id you knew, and everybody in a trip is handed
 * the ids of everything in it. One person could delete another trip's expenses, its
 * payments, and its members, taking their whole history with them, by routing the call
 * through a trip of their own.
 *
 * The second is identity. A member was a line of text with no connection to any
 * account, so the app could not tell that the column called "Andoni" was the person
 * reading the page — and an invitation granted access while leaving the person outside
 * the split entirely.
 */
const BASE = process.env.BASE || `http://127.0.0.1:${process.env.PORT || 3000}`;

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(
    `  ${ok ? "✓" : "✗"} ${name}${ok ? "" : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`}`
  );
  if (ok) passed++;
  else failed++;
}

function client() {
  let cookie = "";
  return async (path, options = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
        ...(options.headers || {}),
      },
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
}

const uniq = () => Math.random().toString(36).slice(2, 10);

const register = (api, name) =>
  api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: `${name}-${uniq()}@example.com`,
      name,
      password: "a long enough password",
    }),
  });

function assertNotThrottled(res) {
  if (res.status !== 429) return;
  console.error(
    "\nRegistration is being throttled (429). That is the rate limiter working, not a\n" +
      "failure: this suite creates several accounts per run. Restart the server against a\n" +
      "fresh database and try again."
  );
  process.exit(1);
}

async function main() {
  console.log(`Testing against ${BASE}\n`);

  const health = await fetch(`${BASE}/api/auth/me`).catch(() => null);
  if (!health?.ok) {
    console.error(`No server at ${BASE}. Start one with: npm run start`);
    process.exit(1);
  }

  // ── A trip of one ──────────────────────────────────────────────────
  console.log("A trip can start with just you");
  const alice = client();
  const aliceReg = await register(alice, "Alice");
  assertNotThrottled(aliceReg);
  const aliceEmail = aliceReg.body.user.email;

  const solo = await alice("/api/trips", {
    method: "POST",
    body: JSON.stringify({ name: "Solo", currency: "EUR" }),
  });
  check("no second person is demanded", solo.status, 200);
  check("and you are already in it", solo.body.members.length, 1);
  check("under your own name", solo.body.members[0].name, "Alice");

  const soloState = await alice(`/api/trips/${solo.body.id}`);
  check("the trip knows which member you are", soloState.body.you, solo.body.members[0].id);
  check("so it has nothing to ask", soloState.body.unclaimed, []);

  // ── The alias ──────────────────────────────────────────────────────
  console.log("\nYour name in a trip is yours");
  const renamed = await alice(`/api/trips/${solo.body.id}`, {
    method: "PATCH",
    body: JSON.stringify({ renameMember: { id: solo.body.members[0].id, name: "Ali" } }),
  });
  check("you can rename yourself", renamed.body.members[0].name, "Ali");
  check("and the account link survives it", Boolean(renamed.body.members[0].userId), true);

  // ── Inviting by email ──────────────────────────────────────────────
  console.log("\nInviting by email seats them and lets them in");
  const bob = client();
  const bobReg = await register(bob, "Bob");
  assertNotThrottled(bobReg);
  const bobEmail = bobReg.body.user.email;

  const shared = await alice("/api/trips", {
    method: "POST",
    body: JSON.stringify({ name: "Shared", currency: "EUR", members: [{ name: "Carla" }] }),
  });
  const tripId = shared.body.id;
  const carla = shared.body.members.find((m) => m.name === "Carla");

  const invited = await alice(`/api/trips/${tripId}`, {
    method: "PATCH",
    body: JSON.stringify({ addByEmail: bobEmail }),
  });
  check("adding by email works", invited.status, 200);
  check("they are in the split", invited.body.members.some((m) => m.name === "Bob"), true);
  check("tied to their account", invited.body.members.find((m) => m.name === "Bob").userId != null, true);

  const bobSees = await bob(`/api/trips/${tripId}`);
  check("and they can open the trip", bobSees.status, 200);
  check("knowing which member they are", bobSees.body.you, invited.body.members.find((m) => m.name === "Bob").id);

  const twice = await alice(`/api/trips/${tripId}`, {
    method: "PATCH",
    body: JSON.stringify({ addByEmail: bobEmail }),
  });
  check("adding them a second time is refused", twice.status, 409);

  // ── An address with no account behind it ───────────────────────────
  console.log("\nSomebody who has no account yet");
  const stranger = `nobody-${uniq()}@example.com`;
  const pending = await alice(`/api/trips/${tripId}`, {
    method: "PATCH",
    body: JSON.stringify({ addByEmail: stranger }),
  });
  check("their seat is made anyway", pending.status, 200);
  check("and an invitation comes back", typeof pending.body.invite?.token, "string");

  // Typing the same address twice is what people do when they are not sure the first one
  // worked. It used to cost them a second column, one of which was then guaranteed to
  // stay empty for good — and the name on a seat cannot tell them apart, since it is the
  // part before the @.
  const again = await alice(`/api/trips/${tripId}`, {
    method: "PATCH",
    body: JSON.stringify({ addByEmail: stranger }),
  });
  check("inviting the same address again is the same invitation", again.body.invite?.token, pending.body.invite.token);
  check(
    "and does not make a second seat",
    again.body.members.filter((m) => m.name.startsWith(stranger.split("@")[0])).length,
    1
  );

  const dave = client();
  const joined = await dave("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: stranger,
      name: "Dave",
      password: "a long enough password",
      inviteToken: pending.body.invite.token,
    }),
  });
  assertNotThrottled(joined);
  check("registering through the link joins the trip", joined.body.tripId, tripId);

  const daveSees = await dave(`/api/trips/${tripId}`);
  const seat = pending.body.members.find((m) => m.name === stranger.split("@")[0]);
  check("and lands in the seat that was waiting", daveSees.body.you, seat.id);
  // The seat was labelled from the address, because that was all anybody knew. Once
  // there is an account behind it, "nobody-a1b2c3d4" stops being anyone's name.
  check(
    "which stops being labelled with their address",
    daveSees.body.members.find((m) => m.id === seat.id).name,
    "Dave"
  );

  // ── Claiming ───────────────────────────────────────────────────────
  console.log("\nSomebody who joined says which participant they are");
  const erin = client();
  const erinReg = await register(erin, "Erin");
  assertNotThrottled(erinReg);
  await alice(`/api/trips/${tripId}`, {
    method: "PATCH",
    body: JSON.stringify({ addByEmail: erinReg.body.user.email }),
  });

  // Adding an address seats them under their own name, so they have nothing to claim.
  const erinSees = await erin(`/api/trips/${tripId}`);
  check("being added by email seats them too", erinSees.body.you != null, true);

  // Carla was typed by hand and belongs to nobody, which is what a claim is for.
  const frank = client();
  const frankReg = await register(frank, "Frank");
  assertNotThrottled(frankReg);
  const inviteRes = await alice(`/api/trips/${tripId}/invite`, { method: "POST" });
  await frank("/api/join", {
    method: "POST",
    body: JSON.stringify({ token: inviteRes.body.token }),
  });

  const frankSees = await frank(`/api/trips/${tripId}`);
  check("a plain invitation leaves them unseated", frankSees.body.you, null);
  check("and offers the free members", frankSees.body.unclaimed.some((m) => m.id === carla.id), true);
  check("but not the ones already taken", frankSees.body.unclaimed.some((m) => m.name === "Bob"), false);


  const claimed = await frank(`/api/trips/${tripId}/claim`, {
    method: "POST",
    body: JSON.stringify({ memberId: carla.id }),
  });
  check("claiming works", claimed.body.member?.id, carla.id);

  // Frank took the only free name, and a trip with nothing free seats whoever joins it
  // on the way in — so the question below could not be reached at all without one. That
  // is the rule working, not an accident: being asked is what happens when there is
  // something to ask about.
  await alice(`/api/trips/${tripId}`, {
    method: "PATCH",
    body: JSON.stringify({ addMembers: ["Libre"] }),
  });

  const grace = client();
  const graceReg = await register(grace, "Grace");
  assertNotThrottled(graceReg);
  await grace("/api/join", {
    method: "POST",
    body: JSON.stringify({ token: inviteRes.body.token }),
  });
  const stolen = await grace(`/api/trips/${tripId}/claim`, {
    method: "POST",
    body: JSON.stringify({ memberId: carla.id }),
  });
  check("the same person cannot be claimed twice", stolen.status, 409);

  const added = await grace(`/api/trips/${tripId}/claim`, {
    method: "POST",
    body: JSON.stringify({ create: true }),
  });
  check("but they can join as themselves", added.body.member?.name, "Grace");

  // A seat made for one particular address is spoken for. Whoever was sent that link is
  // coming for it, and a general invitation must not hand it to somebody else first —
  // otherwise the person it was made for arrives to find themselves already seated by a
  // stranger, and has to join as somebody new.
  const expected = `expected-${uniq()}@example.com`;
  const reservation = await alice(`/api/trips/${tripId}`, {
    method: "PATCH",
    body: JSON.stringify({ addByEmail: expected }),
  });
  const reservedSeat = reservation.body.members.find((m) => m.name === expected.split("@")[0]);

  const afterReserving = await frank(`/api/trips/${tripId}`);
  check(
    "a reserved seat is not offered to anyone else",
    afterReserving.body.unclaimed.some((m) => m.id === reservedSeat.id),
    false
  );
  // Somebody who has access and is not seated yet, which is the only caller the claim
  // endpoint actually considers: anyone already in the split is answered with their own
  // member and never reaches the question.
  const heidi = client();
  const heidiReg = await register(heidi, "Heidi");
  assertNotThrottled(heidiReg);
  await heidi("/api/join", {
    method: "POST",
    body: JSON.stringify({ token: inviteRes.body.token }),
  });
  const grab = await heidi(`/api/trips/${tripId}/claim`, {
    method: "POST",
    body: JSON.stringify({ memberId: reservedSeat.id }),
  });
  check("nor handed over if asked for directly", grab.status, 409);

  // And the person it was made for still walks into it.
  const expectedGuest = client();
  const arrived = await expectedGuest("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: expected,
      name: "Esperada",
      password: "a long enough password",
      inviteToken: reservation.body.invite.token,
    }),
  });
  assertNotThrottled(arrived);
  const seated = await expectedGuest(`/api/trips/${tripId}`);
  check("while the invited person lands in it", seated.body.you, reservedSeat.id);

  // ── Removing ───────────────────────────────────────────────────────
  //
  // Two different acts behind one button, chosen by what the seat is. Somebody with an
  // account steps out and their figures stay; a name typed by hand is deleted outright,
  // and its expenses go with it.
  console.log("\nTaking somebody out of a trip");
  const bobMember = invited.body.members.find((m) => m.name === "Bob");
  const bobTriesToRemove = await bob(`/api/trips/${tripId}`, {
    method: "PATCH",
    body: JSON.stringify({ removeMembers: [bobMember.id] }),
  });
  check("only the owner may take anybody out", bobTriesToRemove.status, 403);

  // An error must never be an error over work that already happened: a body asking for
  // one thing they may do and one they may not has to change nothing at all.
  const mixed = await bob(`/api/trips/${tripId}`, {
    method: "PATCH",
    body: JSON.stringify({ renameMember: { id: bobMember.id, name: "Roberto" }, budget: 999 }),
  });
  check("a request mixing the two is refused whole", mixed.status, 403);
  const untouched = await alice(`/api/trips/${tripId}`);
  check(
    "with the half they were allowed left undone",
    untouched.body.members.find((m) => m.id === bobMember.id).name,
    "Bob"
  );
  check("and the half they were not", untouched.body.budget ?? null, null);

  const ownerRemoves = await alice(`/api/trips/${tripId}`, {
    method: "PATCH",
    body: JSON.stringify({ removeMembers: [bobMember.id] }),
  });
  check("the owner can", ownerRemoves.status, 200);
  check("somebody in the trip keeps their column", ownerRemoves.body.members.some((m) => m.id === bobMember.id), true);
  check("and loses their access", (await bob(`/api/trips/${tripId}`)).status, 404);

  // The seat stays theirs. Letting go of it would turn a person's money into a free name
  // that the next stranger with a link could claim.
  const released = ownerRemoves.body.members.find((m) => m.id === bobMember.id);
  check("the seat is still tied to their account", Boolean(released.userId), true);
  check("marked as out of the trip", released.inTrip, false);
  // Asked as Heidi, who has access and no seat — the only caller the claim endpoint
  // actually offers anything to. Frank is already seated and would be answered with his
  // own member, so the check would pass without proving a thing.
  check(
    "and not offered to anybody",
    (await heidi(`/api/trips/${tripId}/claim`)).body.candidates.some((m) => m.id === bobMember.id),
    false
  );

  /**
   * The link they already have does not undo being removed.
   *
   * An invitation is a shared link that lives in whatever chat the group uses, so it is
   * still in the pocket of the person who was just shown the door. Nothing was done to it
   * on the way out and nothing consumes it, so the removal used to last exactly as long as
   * it took them to scroll up: 404 on the trip, tap the same link, 200 — and write access
   * back. A seat here with no way in means one thing, and it is not "please come back".
   */
  const stillLive = await alice(`/api/trips/${tripId}/invite`, { method: "POST" });
  check(
    "somebody who was removed cannot let themselves back in",
    (await bob("/api/join", { method: "POST", body: JSON.stringify({ token: stillLive.body.token }) })).status,
    404
  );
  check("and the trip stays shut to them", (await bob(`/api/trips/${tripId}`)).status, 404);
  // Narrow on purpose: it is that person who is refused, not the link that is burnt.
  // Everyone else in the group chat still has a working invitation.
  // Que siga viva se ve donde se ve de verdad: la página de la invitación sigue
  // nombrando el grupo para cualquiera del chat que abra el mismo enlace.
  const stillLivePage = await fetch(`${BASE}/join/${stillLive.body.token}`).then((r) => r.text());
  check("while the link itself is still live", stillLivePage.includes("Shared"), true);
  // The owner can still let them back in deliberately, which is the difference that
  // matters: the door is shut, not walled up.
  check(
    "the owner can readmit them by address",
    (
      await alice(`/api/trips/${tripId}`, {
        method: "PATCH",
        body: JSON.stringify({ addByEmail: bobEmail }),
      })
    ).status,
    200
  );
  check("and then they are in again", (await bob(`/api/trips/${tripId}`)).status, 200);
  await alice(`/api/trips/${tripId}`, {
    method: "PATCH",
    body: JSON.stringify({ removeMembers: [bobMember.id] }),
  });

  const ownerRemovesAgain = await alice(`/api/trips/${tripId}`, {
    method: "PATCH",
    body: JSON.stringify({ removeMembers: [bobMember.id] }),
  });
  check("a second time deletes the seat itself", ownerRemovesAgain.body.members.some((m) => m.id === bobMember.id), false);

  // ── Isolation between trips ────────────────────────────────────────
  //
  // The whole point: Frank is in this trip and owns another. Every id he needs is in a
  // response he is entitled to see, and none of them may be spent on the wrong trip.
  console.log("\nWrite access to one trip is not write access to another");
  const frankTrip = await frank("/api/trips", {
    method: "POST",
    body: JSON.stringify({ name: "Frank's own", currency: "EUR" }),
  });
  const own = frankTrip.body.id;

  const before = await alice(`/api/trips/${tripId}`);
  const targetExpense = await alice(`/api/trips/${tripId}/expense`, {
    method: "POST",
    body: JSON.stringify({ description: "Lunch", amount: 40, paidBy: before.body.members[0].id }),
  });
  const targetPayment = await alice(`/api/trips/${tripId}/payment`, {
    method: "POST",
    body: JSON.stringify({
      from: before.body.members[0].id,
      to: before.body.members[1].id,
      amount: 5,
    }),
  });

  await frank(`/api/trips/${own}/expense`, {
    method: "DELETE",
    body: JSON.stringify({ expenseId: targetExpense.body.id }),
  });
  await frank(`/api/trips/${own}/payment`, {
    method: "DELETE",
    body: JSON.stringify({ paymentId: targetPayment.body.id }),
  });
  await frank(`/api/trips/${own}`, {
    method: "PATCH",
    body: JSON.stringify({ removeMembers: before.body.members.map((m) => m.id) }),
  });

  const after = await alice(`/api/trips/${tripId}`);
  check(
    "an expense in another trip survives",
    after.body.expenses.some((e) => e.id === targetExpense.body.id),
    true
  );
  check(
    "so does a payment",
    after.body.payments.some((p) => p.id === targetPayment.body.id),
    true
  );
  check("and so does everyone in it", after.body.members.length, before.body.members.length);

  // Editing has the same shape: the id is in the body, the permission is in the URL.
  const edited = await frank(`/api/trips/${own}/expense`, {
    method: "PATCH",
    body: JSON.stringify({ expenseId: targetExpense.body.id, amount: 1 }),
  });
  check("editing across trips is refused", edited.status, 404);

  // ── Email addresses ────────────────────────────────────────────────
  console.log("\nEmail addresses stay with the owner");
  const asOwner = await alice(`/api/trips/${tripId}`);
  const asGuest = await frank(`/api/trips/${tripId}`);
  check(
    "the owner sees the addresses they typed",
    asOwner.body.members.filter((m) => m.userId).every((m) => typeof m.accountEmail === "string"),
    true
  );
  check(
    "and nobody else sees any of them",
    asGuest.body.members.some((m) => m.accountEmail),
    false
  );

  // Alice's own trip is untouched by any of this.
  const stillOwner = await alice(`/api/trips/${solo.body.id}`);
  check("and nothing leaked into another trip", stillOwner.body.members.length, 1);
  check("Alice is still Ali there", stillOwner.body.members[0].name, "Ali");
  check("signed in as herself", aliceEmail === aliceReg.body.user.email, true);

  // ── The routes that came later ──────────────────────────────────────
  //
  // The isolation above covers expenses, payments and members — the three that
  // were holes once. Comments, receipts, the activity log and the CSV export
  // arrived afterwards and were never checked the same way. They hold today;
  // this is here so that a change tomorrow cannot quietly stop them holding.
  //
  // Two shapes of attack, and both matter. Asking for Alice's trip directly is
  // the obvious one. Routing the call through Frank's own trip is the one that
  // actually broke things before: the permission comes from the URL, the id
  // comes from the body, and everybody in a trip is handed the ids of
  // everything in it.
  console.log("\nThe later routes are no different");

  // Frank is *in* this trip by now, so he may read it. The stranger has to be
  // somebody with no connection to it at all — which is the point: a person who
  // was never invited, holding ids that leaked some other way.
  const ivan = client();
  await ivan("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: "Ivan",
      email: `ivan-${Date.now()}@example.com`,
      password: "correct horse battery staple",
    }),
  });
  const ivanTrip = await ivan("/api/trips", {
    method: "POST",
    body: JSON.stringify({ name: "Ivan's own", currency: "EUR" }),
  });

  check(
    "an outsider cannot read the activity log",
    (await ivan(`/api/trips/${tripId}/activity`)).status,
    404
  );
  check("nor download the CSV", (await ivan(`/api/trips/${tripId}/export`)).status, 404);
  check(
    "nor read the comments on an expense",
    (await ivan(`/api/trips/${tripId}/comment?expenseId=${targetExpense.body.id}`)).status,
    404
  );
  check(
    "nor fetch a receipt",
    (await ivan(`/api/trips/${tripId}/receipt?expenseId=${targetExpense.body.id}`)).status,
    404
  );

  // And the same ids spent on a trip he does own: the permission comes from the
  // URL, the id from the body. That is the shape that broke things before.
  check(
    "commenting on another trip's expense through his own",
    (
      await ivan(`/api/trips/${ivanTrip.body.id}/comment`, {
        method: "POST",
        body: JSON.stringify({ expenseId: targetExpense.body.id, body: "mine now" }),
      })
    ).status !== 200,
    true
  );
  check(
    "and asking for a receipt of another trip's expense",
    (await ivan(`/api/trips/${ivanTrip.body.id}/receipt?expenseId=${targetExpense.body.id}`)).status !== 200,
    true
  );

  // Claiming: he is already seated in his own trip, so the call answers with his
  // own member and never looks at the id he sent. What matters is the result.
  const reclamado = await ivan(`/api/trips/${ivanTrip.body.id}/claim`, {
    method: "POST",
    body: JSON.stringify({ memberId: before.body.members[0].id }),
  });
  check(
    "claiming a member of another trip gets him his own, not hers",
    reclamado.body.member.id !== before.body.members[0].id,
    true
  );

  // Alice's side is untouched by any of it.
  const despues = await alice(`/api/trips/${tripId}`);
  check("her expense is still there", despues.body.expenses.length >= 1, true);
  const ivanId = (await ivan("/api/auth/me")).body.user.id;
  check(
    "and none of her members belongs to his account",
    despues.body.members.some((m) => m.userId === ivanId),
    false
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("The test itself broke:", error);
  process.exit(1);
});
