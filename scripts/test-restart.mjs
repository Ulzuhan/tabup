#!/usr/bin/env node
/**
 * What a restart must not change.
 *
 * Run by `scripts/test-restart.sh`, which starts a server, runs phase one, restarts the
 * server against the same database, and runs phase two.
 *
 * The bug this exists for: the boot repair that made every linked member a member of
 * their trip is right exactly once, against the data that predates the rule. Left to run
 * on every start, it quietly readmitted everybody the owner had taken out — so removing
 * somebody held until the next deploy, reboot or crash, and then undid itself with
 * nobody watching. No HTTP suite could see it, because none of them restart anything.
 */
const BASE = process.env.BASE || `http://127.0.0.1:${process.env.PORT || 3114}`;
const PHASE = process.env.PHASE || "setup";
const STATE = process.env.STATE || "/tmp/tabup-restart-state.json";

import { readFileSync, writeFileSync } from "fs";

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
const PASSWORD = "a long enough password";

async function setup() {
  const alice = client();
  const bob = client();
  const aliceEmail = `alice-${uniq()}@example.com`;
  const bobEmail = `bob-${uniq()}@example.com`;

  for (const [api, email, name] of [
    [alice, aliceEmail, "Alice"],
    [bob, bobEmail, "Bob"],
  ]) {
    const res = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, name, password: PASSWORD }),
    });
    if (res.status !== 200) {
      console.error(`could not register ${name}: ${res.status}`);
      process.exit(1);
    }
  }

  const trip = (
    await alice("/api/trips", {
      method: "POST",
      body: JSON.stringify({ name: "Antes de reiniciar", currency: "EUR", members: [] }),
    })
  ).body;

  await alice(`/api/trips/${trip.id}`, {
    method: "PATCH",
    body: JSON.stringify({ addByEmail: bobEmail }),
  });
  const seat = (await bob(`/api/trips/${trip.id}`)).body.you;

  await bob(`/api/trips/${trip.id}/expense`, {
    method: "POST",
    body: JSON.stringify({ description: "Lo de Bob", amount: 20, paidBy: seat, category: "food" }),
  });

  const out = await alice(`/api/trips/${trip.id}`, {
    method: "PATCH",
    body: JSON.stringify({ removeMembers: [seat] }),
  });
  check("the owner takes them out", out.status, 200);
  check("they lose sight of it", (await bob(`/api/trips/${trip.id}`)).status, 404);

  writeFileSync(STATE, JSON.stringify({ tripId: trip.id, seat, aliceEmail, bobEmail }));
}

async function verify() {
  const { tripId, seat, aliceEmail, bobEmail } = JSON.parse(readFileSync(STATE, "utf-8"));
  const alice = client();
  const bob = client();
  for (const [api, email] of [
    [alice, aliceEmail],
    [bob, bobEmail],
  ]) {
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: PASSWORD }),
    });
  }

  check("after a restart they are still out", (await bob(`/api/trips/${tripId}`)).status, 404);

  const seen = await alice(`/api/trips/${tripId}`);
  check("their column is still there", seen.body.members.some((m) => m.id === seat), true);
  check("still marked as out", seen.body.members.find((m) => m.id === seat).inTrip, false);
  check("and their expense still counts", seen.body.expenses.length, 1);
}

const run = PHASE === "verify" ? verify : setup;
run()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error("The test itself broke:", error);
    process.exit(1);
  });
