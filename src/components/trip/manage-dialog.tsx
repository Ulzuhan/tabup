"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Mail, Trash2, UserPlus, X } from "lucide-react";
import type { Member } from "@/lib/types";
import { MemberAvatar } from "@/components/member-avatar";
import { currencySymbol } from "@/components/money";
import { useT } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface Collaborator {
  id: string;
  email: string;
  name: string;
  role: string;
}

/**
 * Everything about a trip that is not an expense: its name, who is in it, and which
 * accounts can open it.
 *
 * The sharing half talks to an endpoint that has been sitting there fully implemented
 * and tested — roles, invitations, revocation — with no way to reach it from the app.
 */
export function ManageDialog({
  open,
  onOpenChange,
  tripId,
  tripName,
  tripBudget,
  currency,
  members,
  collaborators,
  access,
  anonymous,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tripId: string;
  tripName: string;
  tripBudget?: number | null;
  currency: string;
  members: Member[];
  collaborators: Collaborator[];
  access: "viewer" | "editor" | "owner";
  anonymous: boolean;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState(tripName);
  const [budget, setBudget] = useState(tripBudget != null ? String(tripBudget) : "");
  const [newMember, setNewMember] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [busy, setBusy] = useState<string | null>(null);

  const owner = access === "owner";

  const call = async (key: string, url: string, options: RequestInit, success: string) => {
    setBusy(key);
    try {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...options,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t("manage.failed"));
        return false;
      }
      await onChanged();
      toast.success(success);
      return true;
    } catch {
      toast.error(t("common.serverUnreachable"));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const rename = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === tripName) return;
    await call("rename", `/api/trips/${tripId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: trimmed }),
    }, t("manage.renamed"));
  };

  const saveBudget = async () => {
    const trimmed = budget.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null && !(value > 0)) return;
    await call("budget", `/api/trips/${tripId}`, {
      method: "PATCH",
      body: JSON.stringify({ budget: value }),
    }, t("pace.budget"));
  };

  const addMember = async () => {
    const trimmed = newMember.trim();
    if (!trimmed) return;
    const ok = await call("add", `/api/trips/${tripId}`, {
      method: "PATCH",
      body: JSON.stringify({ addMembers: [trimmed] }),
    }, t("manage.memberAdded"));
    if (ok) setNewMember("");
  };

  const removeMember = async (id: string, memberName: string) => {
    await call(`rm-${id}`, `/api/trips/${tripId}`, {
      method: "PATCH",
      body: JSON.stringify({ removeMembers: [id] }),
    }, t("manage.memberRemoved", { name: memberName }));
  };

  const invite = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    const ok = await call("invite", `/api/trips/${tripId}/share`, {
      method: "POST",
      body: JSON.stringify({ email: trimmed, role }),
    }, t("manage.accessGranted"));
    if (ok) setEmail("");
  };

  const revoke = async (userId: string) => {
    await call(`revoke-${userId}`, `/api/trips/${tripId}/share`, {
      method: "DELETE",
      body: JSON.stringify({ userId }),
    }, t("manage.accessRevoked"));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("manage.title")}</DialogTitle>
          <DialogDescription>{t("manage.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="trip-rename">{t("manage.name")}</Label>
          <div className="flex gap-2">
            <Input
              id="trip-rename"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && rename()}
              className="h-10"
            />
            <Button
              variant="outline"
              onClick={rename}
              disabled={busy !== null || !name.trim() || name.trim() === tripName}
            >
              {busy === "rename" ? <Loader2 className="size-4 animate-spin" /> : t("common.save")}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="trip-budget">{t("pace.budget")}</Label>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                {currencySymbol(currency)}
              </span>
              <Input
                id="trip-budget"
                type="number"
                inputMode="decimal"
                min="0"
                step="10"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveBudget()}
                placeholder={t("pace.noBudget")}
                className="tabular h-10 pl-8"
              />
            </div>
            <Button variant="outline" onClick={saveBudget} disabled={busy !== null}>
              {busy === "budget" ? <Loader2 className="size-4 animate-spin" /> : t("common.save")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("pace.budgetHint")}</p>
        </div>

        <Separator />

        <div className="space-y-2">
          <Label>{t("manage.people")}</Label>
          <ul className="space-y-1">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-lg bg-secondary/40 p-1.5">
                <MemberAvatar emoji={m.emoji} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive disabled:opacity-30"
                  onClick={() => removeMember(m.id, m.name)}
                  disabled={busy !== null || members.length <= 2}
                  aria-label={`${t("common.delete")}: ${m.name}`}
                >
                  {busy === `rm-${m.id}` ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <X className="size-3.5" />
                  )}
                </Button>
              </li>
            ))}
          </ul>

          {/* Removing someone takes their expenses with them, which is not obvious and
              is not undoable. */}
          <p className="text-xs text-muted-foreground">
            {t("manage.removeWarning")}
          </p>

          <div className="flex gap-2 pt-1">
            <Input
              value={newMember}
              onChange={(e) => setNewMember(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addMember()}
              placeholder={t("manage.addSomeone")}
              className="h-10"
            />
            <Button variant="outline" onClick={addMember} disabled={busy !== null || !newMember.trim()}>
              {busy === "add" ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            </Button>
          </div>
        </div>

        {owner && (
          <>
            <Separator />
            <div className="space-y-2">
              <Label>{t("manage.accounts")}</Label>

              {anonymous ? (
                <p className="rounded-lg border border-border bg-secondary/40 p-2.5 text-xs text-muted-foreground">
                  {t("manage.anonymousNote")}
                </p>
              ) : (
                <>
                  <ul className="space-y-1">
                    {collaborators.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center gap-2 rounded-lg bg-secondary/40 p-1.5"
                      >
                        <Mail className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{c.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{c.email}</p>
                        </div>
                        <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[11px]">
                          {c.role}
                        </Badge>
                        {c.role !== "owner" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-destructive"
                            onClick={() => revoke(c.id)}
                            disabled={busy !== null}
                            aria-label={`${t("manage.accessRevoked")}: ${c.email}`}
                          >
                            {busy === `revoke-${c.id}` ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="size-3.5" />
                            )}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>

                  <div className="flex gap-2 pt-1">
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && invite()}
                      placeholder="their@email.com"
                      className="h-10 min-w-0 flex-1"
                    />
                    <Select value={role} onValueChange={(v) => setRole(v as "editor" | "viewer")}>
                      <SelectTrigger className="h-10 w-24 shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="editor">{t("manage.editor")}</SelectItem>
                        <SelectItem value="viewer">{t("manage.viewer")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      onClick={invite}
                      disabled={busy !== null || !email.trim()}
                      className="shrink-0"
                    >
                      {busy === "invite" ? <Loader2 className="size-4 animate-spin" /> : t("manage.invite")}
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {t("manage.inviteHint")}
                  </p>
                </>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
