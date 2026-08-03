import Link from "next/link";
import { cookies, headers } from "next/headers";
import { Compass } from "lucide-react";
import { LOCALE_COOKIE, isLocale, localeFromHeader } from "@/i18n/config";
import { MESSAGES } from "@/i18n/messages";
import { Button } from "@/components/ui/button";

/**
 * The page for a URL that does not exist.
 *
 * Server-rendered and translated without the client provider, because not-found also
 * covers routes that never reach the app's layout state — reaching for a hook here
 * would break exactly when this page matters most.
 */
export default async function NotFound() {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored)
    ? stored
    : localeFromHeader((await headers()).get("accept-language"));
  const t = MESSAGES[locale];

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="text-center">
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-secondary">
          <Compass className="size-7 text-muted-foreground" />
        </div>

        <p className="text-sm font-medium tracking-wider text-muted-foreground uppercase">404</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{t.notFound.title}</h1>
        <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
          {t.notFound.hint}
        </p>

        <Button className="mt-7" render={<Link href="/">{t.notFound.home}</Link>} />
      </div>
    </div>
  );
}
