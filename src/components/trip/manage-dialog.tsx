"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Link2, Loader2, Mail, Trash2, UserPlus, X } from "lucide-react";
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
  /** Absent unless you are the owner, or it is your own row. */
  email?: string;
  name: string;
  role: string;
}

/**
 * Everything about a trip that is not an expense: its name, and who is in it.
 *
 * People used to be two lists that knew nothing of each other — participants as lines
 * of text, collaborators as email addresses — so the same person could appear in both
 * with nothing tying them together, and the app could not tell that the column labelled
 * "Andoni" was the account reading the page. There is one list now: adding somebody by
 * email seats them *and* lets them in, and a bare name is still allowed for the people
 * at the table who will never have an account here.
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
  you,
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
  /** The reader's own participant, when they have claimed one. */
  you: string | null;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState(tripName);
  const [budget, setBudget] = useState(tripBudget != null ? String(tripBudget) : "");
  const [newMember, setNewMember] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  /** An invitation for somebody who has no account yet: the owner sends them this. */
  const [inviteLink, setInviteLink] = useState<string | null>(null);

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

  /**
   * One box for both ways of adding somebody.
   *
   * An address means an account: they get a seat in the split and the access to reach
   * it, in one action. Anything else is a bare name — someone at the table who is not
   * going to register, which is most people — and can be claimed by an account later.
   */
  const isEmail = newMember.includes("@");

  const addPerson = async () => {
    const trimmed = newMember.trim();
    if (!trimmed) return;
    setInviteLink(null);

    if (isEmail) {
      setBusy("add");
      try {
        const res = await fetch(`/api/trips/${tripId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addByEmail: trimmed, role }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data.error || t("manage.failed"));
          return;
        }
        await onChanged();
        setNewMember("");
        // Nobody holds that address yet, so there is a link to send rather than an
        // account to let in. Their seat is already waiting under it.
        if (data.invite?.token) {
          setInviteLink(`${window.location.origin}/join/${data.invite.token}`);
          toast.success(t("manage.inviteReady"));
        } else {
          toast.success(t("manage.accessGranted"));
        }
      } catch {
        toast.error(t("common.serverUnreachable"));
      } finally {
        setBusy(null);
      }
      return;
    }

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

  const saveRename = async () => {
    if (!renaming?.value.trim()) return;
    const ok = await call(`rn-${renaming.id}`, `/api/trips/${tripId}`, {
      method: "PATCH",
      body: JSON.stringify({ renameMember: { id: renaming.id, name: renaming.value.trim() } }),
    }, t("manage.renamed"));
    if (ok) setRenaming(null);
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
            {members.map((m) => {
              const mine = m.id === you;
              // Your own name is yours to set. The owner labels the free members, since
              // somebody typed those names in the first place; nobody else renames a
              // person who has an account.
              const canRename = mine || (owner && !m.userId);
              // Removing a participant takes their expenses with them, so a person with
              // an account is the owner's to remove and nobody else's.
              const canRemove = members.length > 1 && (owner || !m.userId);

              return (
                <li key={m.id} className="flex items-center gap-2 rounded-lg bg-secondary/40 p-1.5">
                  <MemberAvatar emoji={m.emoji} size="sm" />

                  {renaming?.id === m.id ? (
                    <Input
                      autoFocus
                      value={renaming.value}
                      onChange={(e) => setRenaming({ id: m.id, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveRename();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      onBlur={saveRename}
                      className="h-8 min-w-0 flex-1"
                      aria-label={t("manage.alias")}
                    />
                  ) : (
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-sm disabled:cursor-default"
                      disabled={!canRename || busy !== null}
                      onClick={() => setRenaming({ id: m.id, value: m.name })}
                      title={canRename ? t("manage.alias") : undefined}
                    >
                      {m.name}
                    </button>
                  )}

                  {/* What the badge says is whether the app knows who this is. A free
                      member is not lesser — most people at a table are one — but the
                      difference has to be visible, because it is the difference
                      between a name and a person. */}
                  {mine ? (
                    <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[11px]">
                      {t("manage.you")}
                    </Badge>
                  ) : m.userId ? (
                    <Badge variant="outline" className="h-5 shrink-0 gap-1 px-1.5 text-[11px]">
                      <Link2 className="size-3" />
                      {m.accountName ?? t("manage.hasAccount")}
                    </Badge>
                  ) : (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {t("manage.noAccount")}
                    </span>
                  )}

                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-destructive disabled:opacity-30"
                    onClick={() => removeMember(m.id, m.name)}
                    disabled={busy !== null || !canRemove}
                    aria-label={`${t("common.delete")}: ${m.name}`}
                  >
                    {busy === `rm-${m.id}` ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <X className="size-3.5" />
                    )}
                  </Button>
                </li>
              );
            })}
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
              onKeyDown={(e) => e.key === "Enter" && addPerson()}
              placeholder={t("manage.addSomeone")}
              className="h-10 min-w-0 flex-1"
            />
            {/* Only meaningful for an address: a bare name grants nobody anything. */}
            {isEmail && owner && (
              <Select value={role} onValueChange={(v) => setRole(v as "editor" | "viewer")}>
                <SelectTrigger className="h-10 w-24 shrink-0">
                  <SelectValue>
                    {(value) => (value === "viewer" ? t("manage.viewer") : t("manage.editor"))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">{t("manage.editor")}</SelectItem>
                  <SelectItem value="viewer">{t("manage.viewer")}</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Button
              variant="outline"
              onClick={addPerson}
              disabled={busy !== null || !newMember.trim() || (isEmail && !owner)}
              className="shrink-0"
            >
              {busy === "add" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : isEmail ? (
                <Mail className="size-4" />
              ) : (
                <UserPlus className="size-4" />
              )}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">{t("manage.addHint")}</p>

          {inviteLink && (
            <div className="space-y-1 rounded-lg border border-dashed p-2">
              <p className="text-xs text-muted-foreground">{t("manage.inviteReadyHint")}</p>
              <div className="flex gap-2">
                <Input readOnly value={inviteLink} className="h-9 min-w-0 flex-1 text-xs" />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0"
                  onClick={() => {
                    navigator.clipboard?.writeText(inviteLink);
                    toast.success(t("common.copied"));
                  }}
                >
                  {t("common.copy")}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Who can open the trip, which is a different question from who is in the
            split: revoking access does not take somebody out of the arithmetic, and
            their expenses stay where they are. */}
        {owner && collaborators.length > 1 && (
          <>
            <Separator />
            <div className="space-y-2">
              <Label>{t("manage.accounts")}</Label>
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
                            aria-label={`${t("manage.accessRevoked")}: ${c.email ?? c.name}`}
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

                  <p className="text-xs text-muted-foreground">
                    {t("manage.accessHint")}
                  </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
