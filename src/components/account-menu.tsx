"use client";

import { useState } from "react";
import Link from "next/link";
import { Globe, LogOut, Trash2, User as UserIcon, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/i18n/provider";
import { ThemeItems } from "@/components/theme";
import { PushToggle } from "@/components/push-toggle";
import { DeleteAccountDialog } from "@/components/delete-account";
import { LanguageItems } from "@/components/language";
import { clearSessionCache } from "@/lib/session-cache";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  plan: string;
  admin?: boolean;
}

/**
 * Lo propio de TabUp dentro de la cabecera común de KaiCorp Labs.
 *
 * La sesión llega ya resuelta desde el layout, que es servidor. Antes esto vivía
 * en `AppHeader`, la pedía por `fetch` al montar y mostraba un esqueleto mientras
 * llegaba; ahora el primer pintado ya trae el nombre puesto y no hay parpadeo que
 * disimular. También es la razón de que no haya un estado `loading`.
 */
export function AccountMenu({
  user,
  pendingApprovals = 0,
}: {
  user: SessionUser | null;
  pendingApprovals?: number;
}) {
  const t = useT();
  // Fuera del menú a propósito: elegir la opción lo cierra, y un diálogo montado
  // dentro se desmontaría con él.
  const [deleting, setDeleting] = useState(false);

  const signOut = async () => {
    const res = await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    // La caché offline es del navegador, no de la cuenta: dejarla ahí le entrega
    // los viajes a quien entre después en este dispositivo.
    clearSessionCache();
    // Recargar no bastaba: la sesión del proveedor seguía viva y "Sign in"
    // volvía a entrar sin pedir nada.
    const next = res ? (await res.json().catch(() => ({}))).next : null;
    window.location.href = next ?? "/";
  };

  if (!user) {
    return (
      <div className="flex items-center gap-1">
        {/* Sin cuenta no hay menú de usuario, así que el selector de idioma
            necesita su propia entrada: si no, solo se llegaría a él entrando. */}
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
            <DropdownMenuSeparator />
            <ThemeItems />
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
    );
  }

  return (
    <>
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
            Un div normal, no DropdownMenuLabel. Eso mapea a Menu.GroupLabel de Base
            UI, que exige un Menu.Group alrededor — sin él lanza y el menú entero
            deja de abrirse, que es justo lo que pasaba aquí: pulsar tu propio
            nombre no hacía nada.
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
          <ThemeItems />
          <DropdownMenuSeparator />
          <PushToggle />
          <DropdownMenuItem onClick={signOut}>
            <LogOut className="size-4" />
            {t("auth.signOut")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
            <Trash2 className="size-4" />
            {t("account.deleteTitle")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DeleteAccountDialog open={deleting} onOpenChange={setDeleting} />
    </>
  );
}
