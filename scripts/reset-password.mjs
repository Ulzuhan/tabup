#!/usr/bin/env node
/**
 * Sets a new password for an account, from the machine that holds the database.
 *
 *   node scripts/reset-password.mjs --list
 *   node scripts/reset-password.mjs ana@example.com
 *   node scripts/reset-password.mjs ana@example.com "a password I chose"
 *
 * There is no reset-by-email flow, and for a handful of accounts building one — with
 * an email provider, tokens and their expiry — would be more machinery than the
 * problem deserves. What it does close is the real hole: without this, forgetting a
 * password means losing the trips behind it for good.
 *
 * Requires shell access to the server, which is the point: it is not a route, so it
 * cannot be reached from the internet.
 */
import Database from "better-sqlite3";
import { randomBytes, scryptSync } from "node:crypto";
import { join } from "node:path";
import { existsSync } from "node:fs";

const DB_PATH = process.env.TABUP_DB || join(process.cwd(), "data", "tabup.db");

if (!existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}. Set TABUP_DB or run from the project root.`);
  process.exit(1);
}

const db = new Database(DB_PATH);

const [target, chosen] = process.argv.slice(2);

if (!target || target === "--list") {
  const users = db.prepare("SELECT email, name, created_at FROM users ORDER BY created_at").all();
  if (users.length === 0) {
    console.log("No accounts yet.");
  } else {
    console.log(`${users.length} account${users.length === 1 ? "" : "s"}:\n`);
    for (const u of users) {
      console.log(`  ${u.email.padEnd(32)} ${u.name}  (since ${new Date(u.created_at).toISOString().slice(0, 10)})`);
    }
  }
  if (!target) console.log("\nUsage: node scripts/reset-password.mjs <email> [new-password]");
  process.exit(0);
}

const email = target.trim().toLowerCase();
const user = db.prepare("SELECT id, email, name FROM users WHERE email = ?").get(email);

if (!user) {
  console.error(`No account with email ${email}. Run with --list to see them all.`);
  process.exit(1);
}

/**
 * Generated passwords avoid characters that are read wrong out loud or over a chat —
 * no l/1/I, no O/0 — because this one gets typed by hand from another device.
 */
function generatePassword() {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(20);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const password = chosen ?? generatePassword();

if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

// Same format and cost parameters as src/lib/auth.ts: scrypt$N$r$p$salt$hash.
const N = 16384;
const r = 8;
const p = 1;
const salt = randomBytes(16);
const key = scryptSync(password, salt, 64, { N, r, p });
const hash = `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${key.toString("hex")}`;

// Password change and session wipe travel together: whoever was signed in with the old
// password should not stay signed in after it is replaced.
const apply = db.transaction(() => {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, user.id);
  return db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id).changes;
});

const signedOut = apply();

console.log(`\nPassword updated for ${user.name} <${user.email}>.`);
if (!chosen) {
  console.log(`\n  ${password}\n`);
  console.log("Written above only — it is not stored anywhere in readable form.");
}
console.log(`${signedOut} active session${signedOut === 1 ? "" : "s"} signed out.`);

// Proves the stored hash actually verifies, rather than trusting that the format
// matches what the app expects.
const stored = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id).password_hash;
const [, sn, sr, sp, saltHex, keyHex] = stored.split("$");
const check = scryptSync(password, Buffer.from(saltHex, "hex"), Buffer.from(keyHex, "hex").length, {
  N: Number(sn),
  r: Number(sr),
  p: Number(sp),
});
if (check.toString("hex") !== keyHex) {
  console.error("\nThe stored hash does not verify. The account may now be unreachable.");
  process.exit(1);
}
console.log("Verified.");
