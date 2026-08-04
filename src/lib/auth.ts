import { randomBytes, scrypt, timingSafeEqual, createHash } from "crypto";
import type { BinaryLike, ScryptOptions } from "crypto";
import { promisify } from "util";
import { cookies } from "next/headers";
import { eq, lt, sql, isNull, isNotNull, and } from "drizzle-orm";
import { db, users, sessions, trips } from "@/db";
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

/** Cheap client identifier for throttling. Behind a proxy this is the proxy's header. */
export function clientKey(request: Request, suffix = ""): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
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
