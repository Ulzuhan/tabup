"use client";

import Link from "next/link";
import { LogOut, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  plan: string;
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
}: {
  user: SessionUser | null;
  loading: boolean;
  onSignOut: () => void;
  showWordmark?: boolean;
}) {
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
                <span className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="max-w-28 truncate text-sm">{user.name}</span>
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSignOut}>
              <LogOut className="size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          render={
            <Link href="/login">
              <UserIcon className="size-4" />
              Sign in
            </Link>
          }
        />
      )}
    </header>
  );
}
