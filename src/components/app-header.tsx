"use client";

import Link from "next/link";
import { Check, Globe, LogOut, User as UserIcon, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useT, useLocale, setLocale } from "@/i18n/provider";
import { LOCALES, LOCALE_NAMES } from "@/i18n/config";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  plan: string;
  admin?: boolean;
}

/** Wordmark. Kept in one place so the two pages that show it cannot drift. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      Tab<span className="text-primary">Up</span>
    </span>
  );
}

/**
 * The bar across the top of every page.
 *
 * Renders a skeleton rather than nothing while the session is unknown: showing "Sign
 * in" and then swapping it for the user's name a moment later is the kind of flicker
 * that makes an app feel unfinished.
 */
export function AppHeader({
  user,
  loading,
  onSignOut,
  /** Off on the home screen, where the hero already shows the wordmark. */
  showWordmark = true,
  pendingApprovals = 0,
}: {
  user: SessionUser | null;
  loading: boolean;
  onSignOut: () => void;
  showWordmark?: boolean;
  pendingApprovals?: number;
}) {
  const t = useT();

  return (
    <header className="mb-8 flex h-9 w-full items-center justify-between">
      {showWordmark ? (
        <Link
          href="/"
          className="rounded-md text-lg font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Wordmark />
        </Link>
      ) : (
        <span />
      )}

      {loading ? (
        <Skeleton className="h-8 w-24 rounded-full" />
      ) : user ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="sm" className="gap-2 rounded-full pr-3 pl-2">
                <span className="relative flex size-6 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                  {user.name.slice(0, 1).toUpperCase()}
                  {pendingApprovals > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary ring-2 ring-background" />
                  )}
                </span>
                <span className="max-w-28 truncate text-sm">{user.name}</span>
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-56">
            {/*
              A plain div, not DropdownMenuLabel. That maps to Base UI's Menu.GroupLabel,
              which requires a surrounding Menu.Group — without one it throws and the
              whole menu silently fails to open, which is exactly what was happening
              here: clicking your own name did nothing at all.
            */}
            <div className="px-1.5 py-1">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
            <DropdownMenuSeparator />
            {user.admin && (
              <>
                <DropdownMenuItem render={<Link href="/admin" />}>
                  <UserCheck className="size-4" />
                  {t("admin.title")}
                  {pendingApprovals > 0 && (
                    <span className="ml-auto flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                      {pendingApprovals}
                    </span>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <LanguageItems />
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSignOut}>
              <LogOut className="size-4" />
              {t("auth.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className="flex items-center gap-1">
          {/* Without an account there is no user menu, so the language picker needs its
              own way in — otherwise it would only be reachable by signing in. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon" aria-label={t("language")}>
                  <Globe className="size-4" />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <LanguageItems />
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="sm"
            render={
              <Link href="/login">
                <UserIcon className="size-4" />
                {t("auth.signIn")}
              </Link>
            }
          />
        </div>
      )}
    </header>
  );
}

/** The language choices, shared by every menu that offers them. */
export function LanguageItems() {
  const current = useLocale();

  return (
    <>
      {LOCALES.map((code) => (
        <DropdownMenuItem key={code} onClick={() => setLocale(code)}>
          {code === current ? (
            <Check className="size-4 text-primary" />
          ) : (
            <span className="size-4" />
          )}
          {LOCALE_NAMES[code]}
        </DropdownMenuItem>
      ))}
    </>
  );
}
