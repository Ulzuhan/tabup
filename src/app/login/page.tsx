import { redirect } from "next/navigation";
import { oidcConfigured } from "@/lib/oidc";
import { LocalLoginForm } from "./local-form";

/**
 * Two ways in, decided by configuration and not by a code change.
 *
 * With `TABUP_OIDC_*` set, signing in is delegated to the provider: accounts are
 * shared with the other services and there is no password here at all. Anything
 * that used to point at /login — the landing, old bookmarks, the app itself —
 * keeps working by being sent on, and `next` is carried through so somebody who
 * was heading somewhere specific still lands there.
 *
 * With nothing set, the accounts are TabUp's own and this renders the form.
 * That is the default on purpose: cloning the repository and running it should
 * give you a working app, not a redirect to an identity provider you have not
 * got. The password paths behind it were never removed, only unreachable — this
 * is what makes them reachable again.
 */
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (oidcConfigured()) {
    const { next } = await searchParams;
    const safe = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
    redirect(`/api/auth/oidc?next=${encodeURIComponent(safe)}`);
  }

  return <LocalLoginForm />;
}
