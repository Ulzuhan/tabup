#!/usr/bin/env node
/**
 * The parts of a trip that are about people rather than arithmetic.
 *
 *   rm -f data/test.db* && TABUP_DB=data/test.db TABUP_REGISTRATION=open npm run start &
 *   npm run test:social
 *
 * Four things, and each exists because of a specific hole:
 *
 *   The balance on the list of trips. It used to say "3 people · 5 expenses", which is
 *   true and answers nobody's question.
 *
 *   Who entered an expense, and the rule that the person it says paid may fix it. The
 *   permission followed whoever held the phone, so somebody could not correct the record
 *   of their own money.
 *
 *   Comments, which are the alternative to editing: the person who may not change a
 *   figure is exactly the one who needs a way to say it looks wrong.
 *
 *   The activity feed. The model promises that each person answers for what they entered
 *   and the owner may change anything; neither half means much while it leaves no trace.
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

async function register(api, name) {
  const email = `${name.toLowerCase()}-${uniq()}@example.com`;
  const res = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, name, password: "a long enough password" }),
  });
  if (res.status === 429) {
    console.error("\nRegistration is being throttled (429). Restart against a fresh database.");
    process.exit(1);
  }
  return email;
}

async function main() {
  const alice = client();
  const aliceEmail = await register(alice, "Alice");
  const bob = client();
  const bobEmail = await register(bob, "Bob");

  const trip = (
    await alice("/api/trips", {
      method: "POST",
      body: JSON.stringify({ name: "Social", currency: "EUR", members: [] }),
    })
  ).body;
  await alice(`/api/trips/${trip.id}`, {
    method: "PATCH",
    body: JSON.stringify({ addByEmail: bobEmail }),
  });

  const aliceSeat = (await alice(`/api/trips/${trip.id}`)).body.you;
  const bobSeat = (await bob(`/api/trips/${trip.id}`)).body.you;

  // ── Where you stand, on the list ───────────────────────────────────
  console.log("\nThe list of trips says where you stand");
  const empty = (await alice("/api/trips")).body.trips.find((t) => t.id === trip.id);
  check("nothing spent, nothing owed", empty.balance, 0);

  // Alice pays 30 for both: she is owed 15, Bob owes 15.
  await alice(`/api/trips/${trip.id}/expense`, {
    method: "POST",
    body: JSON.stringify({
      description: "Cena",
      amount: 30,
      paidBy: aliceSeat,
      splitAmong: [aliceSeat, bobSeat],
      category: "food",
    }),
  });

  check(
    "the payer is owed half",
    (await alice("/api/trips")).body.trips.find((t) => t.id === trip.id).balance,
    15
  );
  check(
    "and the other owes it",
    (await bob("/api/trips")).body.trips.find((t) => t.id === trip.id).balance,
    -15
  );

  // ── Whose expense is it ────────────────────────────────────────────
  console.log("\nWhoever paid may fix the record of their own money");
  // Alice types an expense that says Bob paid — the usual case of one person holding the
  // phone at the table.
  const bobsExpense = await alice(`/api/trips/${trip.id}/expense`, {
    method: "POST",
    body: JSON.stringify({
      description: "Taxi",
      amount: 20,
      paidBy: bobSeat,
      splitAmong: [aliceSeat, bobSeat],
      category: "transport",
    }),
  });
  check("the owner enters it on their behalf", bobsExpense.status, 200);

  const asBob = await bob(`/api/trips/${trip.id}`);
  const taxi = asBob.body.expenses.find((e) => e.id === bobsExpense.body.id);
  check("the person it says paid may change it", taxi.mine, true);
  check("and is told who typed it", taxi.by, "Alice");
  check(
    "which they can actually do",
    (
      await bob(`/api/trips/${trip.id}/expense`, {
        method: "PATCH",
        body: JSON.stringify({ expenseId: bobsExpense.body.id, amount: 22 }),
      })
    ).status,
    200
  );

  // A third person is neither the author nor the payer.
  const carol = client();
  await register(carol, "Carol");
  await alice(`/api/trips/${trip.id}`, {
    method: "PATCH",
    body: JSON.stringify({ addByEmail: (await carol("/api/auth/me")).body.user.email }),
  });
  check(
    "somebody who is neither may not",
    (
      await carol(`/api/trips/${trip.id}/expense`, {
        method: "PATCH",
        body: JSON.stringify({ expenseId: bobsExpense.body.id, amount: 99 }),
      })
    ).status,
    403
  );
  const asCarol = await carol(`/api/trips/${trip.id}`);
  check(
    "and is told so before trying",
    asCarol.body.expenses.find((e) => e.id === bobsExpense.body.id).mine,
    false
  );

  // ── Comments ───────────────────────────────────────────────────────
  console.log("\nSaying so, instead of changing it");
  const said = await carol(`/api/trips/${trip.id}/comment`, {
    method: "POST",
    body: JSON.stringify({ expenseId: bobsExpense.body.id, body: "¿No fueron 18?" }),
  });
  check("somebody who cannot edit can still speak", said.status, 200);
  check("under the name they go by here", said.body.comment.authorName, "Carol");

  const thread = await bob(`/api/trips/${trip.id}/comment?expenseId=${bobsExpense.body.id}`);
  check("everyone in the trip reads it", thread.body.comments.length, 1);
  check("but it is not theirs to delete", thread.body.comments[0].mine, false);
  check(
    "the owner's is",
    (await alice(`/api/trips/${trip.id}/comment?expenseId=${bobsExpense.body.id}`)).body
      .comments[0].mine,
    true
  );
  check(
    "the list carries the count",
    (await alice(`/api/trips/${trip.id}`)).body.expenses.find(
      (e) => e.id === bobsExpense.body.id
    ).comments,
    1
  );
  check(
    "an empty comment is not one",
    (
      await carol(`/api/trips/${trip.id}/comment`, {
        method: "POST",
        body: JSON.stringify({ expenseId: bobsExpense.body.id, body: "   " }),
      })
    ).status,
    400
  );
  check(
    "nor is one on another trip's expense",
    (
      await carol(`/api/trips/${trip.id}/comment`, {
        method: "POST",
        body: JSON.stringify({ expenseId: aliceSeat, body: "nope" }),
      })
    ).status,
    400
  );

  // ── Nobody is deleted while the money still says something ─────────
  console.log("\nSettle up before deleting anybody");
  const dora = await alice(`/api/trips/${trip.id}`, {
    method: "PATCH",
    body: JSON.stringify({ addMembers: ["Dora"] }),
  });
  const doraSeat = dora.body.members.find((m) => m.name === "Dora").id;
  check(
    "a free member with nothing owing goes",
    (
      await alice(`/api/trips/${trip.id}`, {
        method: "PATCH",
        body: JSON.stringify({ removeMembers: [doraSeat] }),
      })
    ).status,
    200
  );

  const eva = await alice(`/api/trips/${trip.id}`, {
    method: "PATCH",
    body: JSON.stringify({ addMembers: ["Eva"] }),
  });
  const evaSeat = eva.body.members.find((m) => m.name === "Eva").id;
  await alice(`/api/trips/${trip.id}/expense`, {
    method: "POST",
    body: JSON.stringify({
      description: "Lo de Eva",
      amount: 10,
      paidBy: evaSeat,
      splitAmong: [evaSeat, aliceSeat],
      category: "food",
    }),
  });

  const refused = await alice(`/api/trips/${trip.id}`, {
    method: "PATCH",
    body: JSON.stringify({ removeMembers: [evaSeat] }),
  });
  check("one who is owed money does not", refused.status, 409);
  check("and is named", refused.body.names, ["Eva"]);
  check(
    "so nothing was deleted",
    (await alice(`/api/trips/${trip.id}`)).body.members.some((m) => m.id === evaSeat),
    true
  );

  // Settling clears it, and then they can go.
  await alice(`/api/trips/${trip.id}/payment`, {
    method: "POST",
    body: JSON.stringify({ from: aliceSeat, to: evaSeat, amount: 5 }),
  });
  check(
    "once settled up, they can",
    (
      await alice(`/api/trips/${trip.id}`, {
        method: "PATCH",
        body: JSON.stringify({ removeMembers: [evaSeat] }),
      })
    ).status,
    200
  );

  // ── Handing the trip over ──────────────────────────────────────────
  console.log("\nHanding the trip over");
  check(
    "a member cannot help themselves to it",
    (
      await bob(`/api/trips/${trip.id}`, {
        method: "PATCH",
        body: JSON.stringify({ transferOwner: bobSeat }),
      })
    ).status,
    403
  );

  const free = await alice(`/api/trips/${trip.id}`, {
    method: "PATCH",
    body: JSON.stringify({ addMembers: ["Nadie"] }),
  });
  check(
    "a name with nobody behind it cannot be given a trip",
    (
      await alice(`/api/trips/${trip.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          transferOwner: free.body.members.find((m) => m.name === "Nadie").id,
        }),
      })
    ).status,
    400
  );

  const handed = await alice(`/api/trips/${trip.id}`, {
    method: "PATCH",
    body: JSON.stringify({ transferOwner: bobSeat }),
  });
  check("the owner can hand it to somebody in it", handed.status, 200);
  check("who now runs it", (await bob(`/api/trips/${trip.id}`)).body.access, "owner");
  check(
    "and the one who gave it away stays in as a member",
    (await alice(`/api/trips/${trip.id}`)).body.access,
    "member"
  );
  check(
    "keeping their seat and their figures",
    (await alice(`/api/trips/${trip.id}`)).body.you,
    aliceSeat
  );
  check(
    "but no longer the settings",
    (
      await alice(`/api/trips/${trip.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: "Mío otra vez" }),
      })
    ).status,
    403
  );

  // ── The feed ───────────────────────────────────────────────────────
  console.log("\nWhat happened, and who did it");
  const feed = (await carol(`/api/trips/${trip.id}/activity`)).body.entries;
  check("everyone in the trip can read it", Array.isArray(feed), true);
  check("newest first", feed[0].createdAt >= feed[feed.length - 1].createdAt, true);

  const actions = feed.map((e) => e.action);
  for (const expected of [
    "expenseAdded",
    "expenseEdited",
    "commentAdded",
    "memberAdded",
    "memberDeleted",
    "paymentAdded",
    "tripOwner",
  ]) {
    check(`it records ${expected}`, actions.includes(expected), true);
  }
  check(
    "with the name they go by in this trip",
    feed.find((e) => e.action === "commentAdded").actorName,
    "Carol"
  );
  check(
    "and what it was done to",
    feed.some((e) => e.action === "expenseAdded" && e.subject === "Taxi"),
    true
  );
  check(
    "a stranger reads nothing",
    (await client()(`/api/trips/${trip.id}/activity`)).status,
    404
  );

  // Deliberately not recorded: setting your own alias is nobody else's business, and
  // logging it would fill the feed on the first day of any trip.
  await bob(`/api/trips/${trip.id}`, {
    method: "PATCH",
    body: JSON.stringify({ renameMember: { id: bobSeat, name: "Bobby" } }),
  });
  check(
    "setting your own name is not an event",
    (await bob(`/api/trips/${trip.id}/activity`)).body.entries.filter(
      (e) => e.action === "memberRenamed"
    ).length,
    0
  );

  // ── What kind of group this is ─────────────────────────────────────
  console.log("\nA group is not always a trip");
  const flat = await alice("/api/trips", {
    method: "POST",
    body: JSON.stringify({ name: "Piso", kind: "home", currency: "EUR", members: [] }),
  });
  check("a group can say what it is", flat.body.kind, "home");
  check(
    "and it comes back in the list",
    (await alice("/api/trips")).body.trips.find((t) => t.id === flat.body.id).kind,
    "home"
  );
  check(
    "nonsense falls back to a trip",
    (
      await alice("/api/trips", {
        method: "POST",
        body: JSON.stringify({ name: "Raro", kind: "spaceship", currency: "EUR", members: [] }),
      })
    ).body.kind,
    "trip"
  );
  check(
    "the owner can change it",
    (
      await alice(`/api/trips/${flat.body.id}`, {
        method: "PATCH",
        body: JSON.stringify({ kind: "couple" }),
      })
    ).status,
    200
  );
  check("and it stuck", (await alice(`/api/trips/${flat.body.id}`)).body.kind, "couple");

  // ── Notifications ──────────────────────────────────────────────────
  //
  // Delivery itself needs a real browser and its vendor's push service, so what is
  // checked here is everything this server is responsible for: it has a key to hand out,
  // it remembers a subscription, and it forgets it on request.
  console.log("\nNotifications");
  const keyed = await alice("/api/push");
  check("the instance hands out a key of its own", typeof keyed.body.publicKey, "string");
  check("a long one", keyed.body.publicKey.length > 80, true);
  check("nobody is subscribed to start with", keyed.body.subscribed, false);

  const endpoint = `https://push.example.com/${uniq()}`;
  const subscription = {
    endpoint,
    keys: { p256dh: "BOrq".padEnd(87, "x"), auth: "c2VjcmV0MTIzNDU2Nzg" },
  };
  check(
    "a browser can subscribe",
    (
      await alice("/api/push", { method: "POST", body: JSON.stringify({ subscription }) })
    ).body.subscribed,
    true
  );
  check(
    "and the server says so afterwards",
    (await alice(`/api/push?endpoint=${encodeURIComponent(endpoint)}`)).body.subscribed,
    true
  );
  check(
    "somebody else's browser is not theirs",
    (await bob(`/api/push?endpoint=${encodeURIComponent(endpoint)}`)).body.subscribed,
    false
  );
  check(
    "a request without a subscription in it is refused",
    (await alice("/api/push", { method: "POST", body: JSON.stringify({ subscription: {} }) })).status,
    400
  );
  // An endpoint arriving in a body is a claim about a browser, not proof of holding one.
  // Unscoped, this deleted the row and answered 200, so anybody who learned somebody
  // else's endpoint could switch their notifications off and nothing would say why.
  await bob("/api/push", { method: "DELETE", body: JSON.stringify({ endpoint }) });
  check(
    "somebody else cannot unsubscribe your browser",
    (await alice(`/api/push?endpoint=${encodeURIComponent(endpoint)}`)).body.subscribed,
    true
  );
  check(
    "signed out, there is nothing to ask",
    (await client()("/api/push")).status,
    401
  );
  check(
    "unsubscribing works",
    (
      await alice("/api/push", { method: "DELETE", body: JSON.stringify({ endpoint }) })
    ).body.subscribed,
    false
  );
  check(
    "and it is really gone",
    (await alice(`/api/push?endpoint=${encodeURIComponent(endpoint)}`)).body.subscribed,
    false
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("The test itself broke:", error);
  process.exit(1);
});
