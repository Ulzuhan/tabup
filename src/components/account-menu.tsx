"use client";

import Link from "next/link";
import { ExternalLink, Globe, LogOut, SlidersHorizontal, User as UserIcon, UserCheck } from "lucide-react";
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
import { LanguageItems } from "@/components/language";
import { clearSessionCache } from "@/lib/session-cache";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  plan: string;
  admin?: boolean;
  /** Del perfil: con la que se abre el formulario de crear grupo. Ver /settings. */
  defaultCurrency?: string;
  /** Del perfil: la cara elegida, que también se lleva puesta en la cabecera. */
  emoji?: string | null;
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
  accountUrl = null,
}: {
  user: SessionUser | null;
  pendingApprovals?: number;
  /** La página de la cuenta en el proveedor, cuando quien despliega la publica. */
  accountUrl?: string | null;
}) {
  const t = useT();

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
              {/* Tu cara si la elegiste, y si no la inicial de siempre: es el mismo
                  dibujo que llevas en los grupos, y verlo aquí es lo que hace que
                  elegirla signifique algo fuera de la página de ajustes. */}
              <span className="relative flex size-6 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                {user.emoji ?? user.name.slice(0, 1).toUpperCase()}
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
          {/*
            Cuatro líneas, y las cuatro son navegación: quién eres, dónde se cambia lo
            tuyo, dónde vive tu cuenta de verdad y la salida.

            Aquí había nueve, y con ellas el idioma, el aspecto, los avisos y el borrado
            de la cuenta. Un menú vale mientras los ajustes son tres interruptores sin
            nada que explicar; en cuanto lo que se ajusta es lo que otra gente ve de ti
            —tu nombre en sus grupos, tu cara, cómo te pagan— hace falta sitio para decir
            a quién afecta cada cosa, y eso es una página. Están todos en /settings.
          */}
          {user.admin && (
            <DropdownMenuItem render={<Link href="/admin" />}>
              <UserCheck className="size-4" />
              {t("admin.title")}
              {pendingApprovals > 0 && (
                <span className="ml-auto flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                  {pendingApprovals}
                </span>
              )}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem render={<Link href="/settings" />}>
            <SlidersHorizontal className="size-4" />
            {t("settings.title")}
          </DropdownMenuItem>
          {accountUrl && (
            <DropdownMenuItem
              render={<a href={accountUrl} target="_blank" rel="noreferrer" />}
            >
              <ExternalLink className="size-4" />
              {t("settings.providerAccount")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={signOut}>
            <LogOut className="size-4" />
            {t("auth.signOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>


    </>
  );
}
