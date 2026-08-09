import { randomBytes, scrypt, timingSafeEqual, createHash } from "crypto";
import type { BinaryLike, ScryptOptions } from "crypto";
import { promisify } from "util";
import { cookies } from "next/headers";
import { eq, lt, sql, isNull, isNotNull, and } from "drizzle-orm";
import { db, users, sessions, trips, passwordResets } from "@/db";
import type { UserRow } from "@/db";

/**
 * Accounts, sessions and password hashing.
 *
 * Deliberately hand-rolled rather than pulling in an auth framework: the whole surface
 * is email plus password plus a session cookie, and a dependency that owns the login
 * flow would be harder to audit than the eighty lines below.
 */

/**
 * promisify loses the overload that takes cost parameters, so the signature is spelled
 * out here rather than casting at each call site.
 */
const scryptAsync = promisify(scrypt) as (
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  options: ScryptOptions
) => Promise<Buffer>;

/** OWASP's floor for scrypt. Costs ~100ms per hash, which is the point. */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

export const SESSION_COOKIE = "tabup_session";
const SESSION_DAYS = 30;

// ── Passwords ────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${key.toString("hex")}`;
}

/**
 * Verifies a password against a stored hash.
 *
 * The cost parameters come out of the stored string rather than the constants above,
 * so raising them later does not lock out everyone who registered before.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltHex, keyHex] = parts;
  let expected: Buffer;
  try {
    expected = Buffer.from(keyHex, "hex");
    const key = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

// ── Sessions ─────────────────────────────────────────────────────────────

/** The database stores this, never the token itself. */
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Issues a session and sets the cookie.
 *
 * httpOnly keeps it away from any script on the page, sameSite=lax means it is not
 * attached to cross-site POSTs, which is what stops a third-party page from adding
 * expenses on the user's behalf.
 */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = now + SESSION_DAYS * 24 * 60 * 60 * 1000;

  db.insert(sessions)
    .values({ tokenHash: hashToken(token), userId, createdAt: now, expiresAt })
    .run();

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

/** Returns the signed-in user, or null. Expired sessions are deleted as they are met. */
export async function getCurrentUser(): Promise<UserRow | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);
  const row = db
    .select({ userId: sessions.userId, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash))
    .get();

  if (!row) return null;
  if (row.expiresAt < Date.now()) {
    db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run();
    return null;
  }

  return db.select().from(users).where(eq(users.id, row.userId)).get() ?? null;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run();
  }
  store.delete(SESSION_COOKIE);
}

/** Signing out everywhere, used after a password change. */
export function destroyAllSessions(userId: string): void {
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
}

export function purgeExpiredSessions(): void {
  db.delete(sessions).where(lt(sessions.expiresAt, Date.now())).run();
}

// ── Getting back in ──────────────────────────────────────────────────────

/**
 * An hour.
 *
 * Long enough to send somebody a link and have them open it after lunch, short enough
 * that one forgotten in a chat is a dead string by the evening. There is no email here,
 * so this link travels through whatever people already talk on and stays in that
 * conversation — which is exactly why it should stop working quickly.
 */
const RESET_MINUTES = 60;

/**
 * Issues a link that lets one person set a new password, once.
 *
 * The admin's alternative — typing a password and dictating it — is worse in three
 * separate ways: it never expires, anyone who scrolls back in the conversation can read
 * it, and it is a password the person did not choose and will not remember.
 *
 * Any earlier link for that account is dropped: asking again should not leave two keys
 * under the mat.
 */
export function createPasswordReset(userId: string): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = now + RESET_MINUTES * 60 * 1000;

  db.delete(passwordResets).where(eq(passwordResets.userId, userId)).run();
  db.insert(passwordResets)
    .values({ tokenHash: hashToken(token), userId, createdAt: now, expiresAt })
    .run();

  return { token, expiresAt };
}

export type ResetState = "ok" | "expired" | "used" | "unknown";

/** What a link is worth, without spending it. Used by the page before showing a form. */
export function readPasswordReset(
  token: string
): { state: ResetState; email?: string; name?: string } {
  if (!token || token.length > 64) return { state: "unknown" };

  const row = db
    .select()
    .from(passwordResets)
    .where(eq(passwordResets.tokenHash, hashToken(token)))
    .get();
  if (!row) return { state: "unknown" };
  if (row.usedAt) return { state: "used" };
  if (row.expiresAt < Date.now()) return { state: "expired" };

  const user = db.select().from(users).where(eq(users.id, row.userId)).get();
  if (!user) return { state: "unknown" };
  return { state: "ok", email: user.email, name: user.name };
}

/**
 * Spends a link and sets the password.
 *
 * Named `redeem` rather than `use` for two reasons: it is what the invitation flow
 * already calls spending a token, and anything beginning with `use` is read as a React
 * hook by every tool in this project.
 *
 * Every other session goes with it. Somebody who needed this either lost their way in or
 * suspects that somebody else has it, and both of those are answered by the same thing:
 * everything signed in anywhere stops being signed in.
 */
export async function redeemPasswordReset(
  token: string,
  password: string
): Promise<{ state: ResetState; userId?: string }> {
  const row = db
    .select()
    .from(passwordResets)
    .where(eq(passwordResets.tokenHash, hashToken(token)))
    .get();
  if (!row) return { state: "unknown" };
  if (row.usedAt) return { state: "used" };
  if (row.expiresAt < Date.now()) return { state: "expired" };

  const hash = await hashPassword(password);

  /**
   * The link is spent by the same statement that checks it is unspent.
   *
   * The check above is a hundred milliseconds old by the time anything is written —
   * hashing a password is deliberately slow, and the request yields while it happens. Two
   * redemptions arriving together therefore both passed it, and both went on to write:
   * measured, they each answered `{ok: true}`, the second one's password was the live one,
   * and its `DELETE FROM sessions` took the first one's brand-new session with it. Whoever
   * arrived last owned the account and whoever arrived first was told it had worked.
   *
   * That matters because of where these links travel. There is no email here, so one goes
   * through whatever people already talk on, and a link sitting in a group chat being
   * single-use is the entire reason the second person to try it is supposed to be refused.
   *
   * `WHERE used_at IS NULL` moves the guard to where the write is. SQLite runs one writer
   * at a time, so exactly one of the two can report a change; the other finds nothing to
   * update and is told the link is used, which is true.
   */
  let claimed = false;
  db.transaction((tx) => {
    const spent = tx
      .update(passwordResets)
      .set({ usedAt: Date.now() })
      .where(and(eq(passwordResets.tokenHash, row.tokenHash), isNull(passwordResets.usedAt)))
      .run();
    if (spent.changes === 0) return;

    claimed = true;
    tx.update(users).set({ passwordHash: hash }).where(eq(users.id, row.userId)).run();
    tx.delete(sessions).where(eq(sessions.userId, row.userId)).run();
  });
  if (!claimed) return { state: "used" };

  return { state: "ok", userId: row.userId };
}

// ── Users ────────────────────────────────────────────────────────────────

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Good enough to catch typos; real validation is whether the person can sign in. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

/**
 * Password rules kept to a length floor.
 *
 * Composition requirements ("one uppercase, one symbol") measurably push people towards
 * `Password1!`, so length is the only thing enforced here.
 */
export function passwordProblem(password: string): string | null {
  if (typeof password !== "string" || password.length < 8) {
    return "Password must be at least 8 characters";
  }
  if (password.length > 200) return "Password must be at most 200 characters";
  return null;
}

export async function createUser(
  email: string,
  name: string,
  password: string,
  /** Invitations and the open mode skip the queue; a plain request does not. */
  options: { approved?: boolean } = {}
): Promise<UserRow | null> {
  const id = randomBytes(16).toString("hex");
  const now = Date.now();

  const [{ count }] = db.select({ count: sql<number>`count(*)` }).from(users).all();
  const isFirst = count === 0;

  const row = {
    id,
    email: normalizeEmail(email),
    name: name.trim().slice(0, 80),
    passwordHash: await hashPassword(password),
    createdAt: now,
    plan: "free",
    // Whoever sets the instance up runs it: there is nobody else to approve them.
    role: isFirst ? "admin" : "user",
    approvedAt: isFirst || options.approved ? now : null,
  };

  try {
    db.insert(users).values(row).run();
  } catch {
    // The unique index on email is what makes concurrent registrations safe.
    return null;
  }

  // On a fresh install the first account adopts any trip left without an owner, which
  // is how a database restored from before accounts existed stays reachable.
  if (isFirst) {
    db.update(trips).set({ ownerId: id }).where(isNull(trips.ownerId)).run();
  }

  return row;
}

export async function authenticate(email: string, password: string): Promise<UserRow | null> {
  const user = db.select().from(users).where(eq(users.email, normalizeEmail(email))).get();

  // Hash anyway when the account does not exist, so response time does not reveal
  // which emails are registered.
  if (!user) {
    await hashPassword(password);
    return null;
  }

  return (await verifyPassword(password, user.passwordHash)) ? user : null;
}

/** What the client is allowed to see about itself. */
export function publicUser(user: UserRow) {
  return { id: user.id, email: user.email, name: user.name, plan: user.plan };
}

// ── Login throttling ─────────────────────────────────────────────────────

/**
 * In-process attempt counter.
 *
 * Enough for a single instance, which is what this deployment is. Moving to more than
 * one process means moving this into the database or a shared cache.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

export function tooManyAttempts(key: string): boolean {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < Date.now()) return false;
  return entry.count >= MAX_ATTEMPTS;
}

export function recordAttempt(key: string): void {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count++;

  // Bounded cleanup so a stream of distinct keys cannot grow this without limit.
  if (attempts.size > 10_000) {
    for (const [k, v] of attempts) if (v.resetAt < now) attempts.delete(k);
  }
}

export function clearAttempts(key: string): void {
  attempts.delete(key);
}

/**
 * Cheap client identifier for throttling.
 *
 * Behind a proxy this is whatever the proxy says. When nothing says anything, every
 * caller shares the key `local` — which is a shared counter, not an identifier, so ten
 * attempts from anybody would lock out everybody. That is why a successful login clears
 * it: without that, ten *correct* sign-ins in a quarter of an hour were enough to shut
 * the whole instance out, which is a normal evening in a household.
 */
export function clientKey(request: Request, suffix = ""): string {
  const forwarded =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim();
  return `${forwarded || "local"}:${suffix}`;
}

// ── Registration policy ──────────────────────────────────────────────────

/**
 * How this instance handles people asking for an account.
 *
 *   closed    only invitations get anyone in (the default)
 *   approval  anyone may ask; the admin lets them in
 *   open      anyone may register and use it straight away
 *
 * A single setting rather than a boolean, because "closed" and "needs approving" are
 * different answers to the same question and the old flag could not tell them apart.
 * `TABUP_ALLOW_REGISTRATION=true` is still honoured as "open" so an existing deployment
 * does not change behaviour on upgrade.
 */
export type RegistrationMode = "closed" | "approval" | "open";

export function registrationMode(): RegistrationMode {
  const raw = process.env.TABUP_REGISTRATION?.trim().toLowerCase();
  if (raw === "open" || raw === "approval" || raw === "closed") return raw;
  if (process.env.TABUP_ALLOW_REGISTRATION?.trim().toLowerCase() === "true") return "open";
  return "closed";
}

/** Whether the sign-up form is worth showing at all. */
export function registrationOpen(): boolean {
  // The very first account is always allowed, or a fresh install could never be set up.
  const [{ count }] = db.select({ count: sql<number>`count(*)` }).from(users).all();
  if (count === 0) return true;
  return registrationMode() !== "closed";
}

// ── Approvals ────────────────────────────────────────────────────────

export const isAdmin = (user: UserRow | null) => user?.role === "admin";
export const isApproved = (user: UserRow) => user.approvedAt != null;

/** Accounts waiting on the admin, oldest request first. */
export function pendingUsers() {
  return db
    .select({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt })
    .from(users)
    .where(isNull(users.approvedAt))
    .orderBy(users.createdAt)
    .all();
}

export function approveUser(userId: string): boolean {
  const result = db
    .update(users)
    .set({ approvedAt: Date.now() })
    .where(and(eq(users.id, userId), isNull(users.approvedAt)))
    .run();
  return result.changes > 0;
}

/**
 * Turns a request down by deleting the account.
 *
 * Only ever reaches an account that was never approved, so there is nothing of theirs
 * to lose — and it frees the email address in case they typo'd it and want to try again.
 */
export function rejectUser(userId: string): boolean {
  const result = db
    .delete(users)
    .where(and(eq(users.id, userId), isNull(users.approvedAt)))
    .run();
  return result.changes > 0;
}

/** Every approved account, for the admin's list. */
export function approvedUsers() {
  return db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(isNotNull(users.approvedAt))
    .orderBy(users.createdAt)
    .all();
}

/**
 * Sets somebody's password for them.
 *
 * This is what stands in for a reset email on an instance that sends no mail: the person
 * who runs it can hand out a new password directly. Every session of theirs is dropped
 * at the same time — if the reason for the change is that someone else got in, leaving
 * that someone signed in would defeat the whole exercise.
 *
 * Deliberately no "current password" check, because the admin does not have it. That
 * makes this the one place in the app where being the admin means being able to read
 * another person's trips, by taking over their account. It is a real power and the
 * alternative — losing an account permanently to a forgotten password — is worse on an
 * instance with no other way back in.
 */
export async function setPassword(userId: string, password: string): Promise<boolean> {
  const result = db
    .update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(users.id, userId))
    .run();

  if (result.changes === 0) return false;
  destroyAllSessions(userId);
  return true;
}
