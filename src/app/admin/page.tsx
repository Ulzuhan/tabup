import { notFound } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { AdminPanel } from "./admin-panel";
import { oidcConfigured } from "@/lib/oidc";

export const metadata = { title: "TabUp" };

/**
 * The admin panel, behind a door on this side of the network.
 *
 * The panel itself is a client component and every endpoint it talks to re-checks the
 * role, so nothing was ever *shown* to somebody who should not see it. But the page
 * loaded: a normal account could open /admin and get the furniture — headings, an empty
 * approvals list, a password dialog — with the data missing for reasons it could not
 * explain. A page you may not use should not be a page you can open.
 *
 * `notFound` rather than a refusal, for the same reason a trip you cannot see is a 404:
 * whether this instance has an admin panel at a guessable path is not worth confirming
 * to somebody who is trying paths.
 */
export default async function AdminPage() {
  if (!isAdmin(await getCurrentUser())) notFound();
  return <AdminPanel localAuth={!oidcConfigured()} />;
}
