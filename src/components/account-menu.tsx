"use client";

import Link from "next/link";
import { Globe, User as UserIcon, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { KaiCorpAccountMenu, KaiCorpMenuItem } from "@/components/kaicorp-account-menu";
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
 * El menú de la cuenta ya no se pinta aquí: es `KaiCorpAccountMenu`, cromado común
 * repartido por `sync-theme.sh` como la cabecera y el pie. Las cinco aplicaciones lo
 * resolvían de cinco formas distintas —dos desplegables con dos implementaciones, dos
 * sin menú y una con la cuenta fuera de la cabecera— y esto es lo mismo que ya se hizo
 * con la letra y el marco. Lo que sigue siendo de TabUp: el enlace de administración
 * cuando lo hay, la caché sin conexión que hay que limpiar al salir, y lo que ve quien
 * no ha entrado, que es donde vive el selector de idioma para quien no tiene cuenta.
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
    <KaiCorpAccountMenu
      email={user.email}
      name={user.name}
      emoji={user.emoji}
      settingsHref="/settings"
      accountUrl={accountUrl}
      beforeSignOut={clearSessionCache}
      labels={{
        menu: t("settings.title"),
        settings: t("settings.title"),
        account: t("settings.providerAccount"),
        signOut: t("auth.signOut"),
        signingOut: t("common.loading"),
      }}
      extra={
        user.admin ? (
          <KaiCorpMenuItem href="/admin">
            <UserCheck className="size-4" />
            {t("admin.title")}
            {pendingApprovals > 0 && (
              <span
                className="ml-auto flex size-5 items-center justify-center rounded-full text-[11px] font-semibold"
                style={{ background: "var(--kc-accent)", color: "var(--kc-accent-ink)" }}
              >
                {pendingApprovals}
              </span>
            )}
          </KaiCorpMenuItem>
        ) : null
      }
    />
  );
}
