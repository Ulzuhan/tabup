import { randomBytes, scrypt, timingSafeEqual, createHash } from "crypto";
import type { BinaryLike, ScryptOptions } from "crypto";
import { promisify } from "util";
import { cookies } from "next/headers";
import { eq, lt } from "drizzle-orm";
import { db, users, sessions } from "@/db";
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

export const SESSION_COOKIE = "splittrip_session";
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
  password: string
): Promise<UserRow | null> {
  const id = randomBytes(16).toString("hex");
  const row = {
    id,
    email: normalizeEmail(email),
    name: name.trim().slice(0, 80),
    passwordHash: await hashPassword(password),
    createdAt: Date.now(),
    plan: "free",
  };

  try {
    db.insert(users).values(row).run();
  } catch {
    // The unique index on email is what makes concurrent registrations safe.
    return null;
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
