"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerError, useT } from "@/i18n/provider";
import { clearSessionCache } from "@/lib/session-cache";

/**
 * Closing your own account.
 *
 * There was no way to do this from inside the app, which for something holding a record
 * of what somebody spends is a gap worth closing regardless of who else uses this
 * instance: the only exit was asking whoever runs the server to open the database.
 *
 * The dialog says what will happen before it asks for anything, because the consequences
 * reach other people's screens and none of them are guessable: a group they run passes to
 * somebody else, a group nobody else is in goes with them, and the column of figures they
 * left in other people's groups stays where it is. A confirmation that only says "are you
 * sure?" is a confirmation of nothing.
 *
 * The password is asked for again on purpose. A session is whoever is holding the phone.
 *
 * Salvo que las cuentas sean de un proveedor de identidad: entonces aquí no hay
 * contraseña que comprobar —la de una cuenta OIDC es un relleno que no valida nunca— y
 * pedirla dejaba esta pantalla sin salida. En ese caso se escribe la dirección de la
 * cuenta, que confirma la intención aunque no pruebe la identidad. El porqué completo
 * está en `DELETE /api/auth/me`.
 */
export function DeleteAccountDialog({
  open,
  onOpenChange,
  providerAccounts = false,
  email,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Las cuentas las lleva un proveedor: no hay contraseña propia que pedir. */
  providerAccounts?: boolean;
  /** La dirección que hay que escribir para confirmar, cuando es el caso. */
  email?: string;
}) {
  const t = useT();
  const serverError = useServerError();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !password) return;
    setBusy(true);

    try {
      const res = await fetch("/api/auth/me", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(providerAccounts ? { confirm: password } : { password }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(serverError(data, "account.deleteFailed"));
        setBusy(false);
        return;
      }

      // Nothing of theirs may be left on this device: the offline cache is per browser,
      // not per account, and the account it belonged to no longer exists.
      clearSessionCache();
      router.push("/");
      router.refresh();
    } catch {
      toast.error(t("common.serverUnreachable"));
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("account.deleteTitle")}</DialogTitle>
          <DialogDescription>{t("account.deleteIntro")}</DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            {t("account.deleteHandover")}
          </li>
          <li className="flex gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            {t("account.deleteAlone")}
          </li>
          <li className="flex gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            {t("account.deleteFigures")}
          </li>
        </ul>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="delete-password">
              {providerAccounts
                ? t("account.deleteConfirmEmail", { email: email ?? "" })
                : t("account.deleteConfirm")}
            </Label>
            <Input
              id="delete-password"
              type={providerAccounts ? "email" : "password"}
              autoComplete={providerAccounts ? "off" : "current-password"}
              inputMode={providerAccounts ? "email" : undefined}
              autoCapitalize={providerAccounts ? "none" : undefined}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={busy || !password}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {t("account.deleteAction")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
