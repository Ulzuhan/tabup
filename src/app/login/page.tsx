import { redirect } from "next/navigation";

/**
 * Signing in moved to Authentik.
 *
 * Accounts are shared across every KaiCorp service now, so the local form is
 * not the way in any more. Everything that used to point at /login — the
 * landing, old bookmarks, the app itself — keeps working by being sent on to
 * the provider instead of hitting a dead page.
 *
 * `next` is carried through so somebody who was heading somewhere specific
 * still lands there afterwards. The local form is kept next door as
 * local-form.tsx: unreachable, but the password paths behind it are still
 * there for an emergency where the provider is down.
 */
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safe = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
  redirect(`/api/auth/oidc?next=${encodeURIComponent(safe)}`);
}
