"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Check, Loader2, UserCheck, X } from "lucide-react";
import { useT, useIntlLocale } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface PendingUser {
  id: string;
  email: string;
  name: string;
  createdAt: number;
}

/**
 * Account requests, for whoever runs this instance.
 *
 * Reachable only from the admin's own menu, and the API re-checks the role on every
 * call — hiding a page is not access control.
 */
export default function AdminPage() {
  const t = useT();
  const locale = useIntlLocale();

  const [pending, setPending] = useState<PendingUser[] | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/users").catch(() => null);
    if (!res?.ok) {
      setAllowed(false);
      return;
    }
    const data = await res.json();
    setAllowed(true);
    setPending(data.pending ?? []);
  }, []);

  useEffect(() => {
    Promise.resolve().then(load);
  }, [load]);

  const act = async (user: PendingUser, action: "approve" | "reject") => {
    setBusy(user.id);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t("common.somethingWrong"));
        return;
      }
      setPending(data.pending ?? []);
      toast.success(
        action === "approve" ? t("admin.approved", { name: user.name }) : t("admin.rejected")
      );
    } catch {
      toast.error(t("common.serverUnreachable"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pt-5 pb-16 sm:pt-8">
      <Link
        href="/"
        className="mb-6 inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t("common.back")}
      </Link>

      <h1 className="text-xl font-semibold tracking-tight">{t("admin.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("admin.subtitle")}</p>

      <div className="mt-6">
        {allowed === null ? (
          <Skeleton className="h-20 w-full rounded-xl" />
        ) : !allowed ? (
          <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            {t("common.somethingWrong")}
          </p>
        ) : pending && pending.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center">
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-secondary">
              <UserCheck className="size-6 text-muted-foreground" />
            </div>
            <p className="font-medium">{t("admin.none")}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {pending?.map((user) => (
              <li key={user.id}>
                <Card>
                  <CardContent className="flex flex-wrap items-center gap-3 py-1">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{user.name}</p>
                      <p className="truncate text-sm text-muted-foreground">{user.email}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t("admin.requestedOn", {
                          date: new Date(user.createdAt).toLocaleDateString(locale),
                        })}
                      </p>
                    </div>

                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => act(user, "reject")}
                        disabled={busy !== null}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="size-4" />
                        {t("admin.reject")}
                      </Button>
                      <Button size="sm" onClick={() => act(user, "approve")} disabled={busy !== null}>
                        {busy === user.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Check className="size-4" />
                        )}
                        {t("admin.approve")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
