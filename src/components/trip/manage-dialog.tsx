"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Crown, Link2, Loader2, Mail, UserPlus, X } from "lucide-react";
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

/**
 * Everything about a trip that is not an expense: its name, and who is in it.
 *
 * People used to be two lists that knew nothing of each other — participants as lines of
 * text, accounts with access as email addresses — so the same person appeared in both
 * with nothing tying them together, and the app could not tell that the column labelled
 * "Andoni" was the account reading the page. There is one list now, and it is this one:
 * being in a trip and being in its split are the same fact. A bare name is still allowed
 * for the people at the table who will never have an account here.
 *
 * The trip belongs to whoever made it, so its name, its budget and who comes into it are
 * theirs. Everyone else gets exactly one thing here, and it is the right one: what they
 * are called in this trip.
 */
export function ManageDialog({
  open,
  onOpenChange,
  tripId,
  tripName,
  tripBudget,
  currency,
  members,
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
  access: "member" | "owner";
  /** The reader's own participant, when they have claimed one. */
  you: string | null;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState(tripName);
  const [budget, setBudget] = useState(tripBudget != null ? String(tripBudget) : "");
  const [newMember, setNewMember] = useState("");
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
          body: JSON.stringify({ addByEmail: trimmed }),
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

  /**
   * One button, two outcomes, decided by what the seat is.
   *
   * Somebody with an account steps out of the trip: they lose their access and their
   * column stays, with every figure in it. A free member is a label, so it goes, and its
   * expenses with it. Pressing it a second time on the same person — now a free member —
   * does the destructive half, deliberately as a separate decision.
   */
  const removeMember = async (id: string, memberName: string, linked: boolean) => {
    setBusy(`rm-${id}`);
    try {
      const res = await fetch(`/api/trips/${tripId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removeMembers: [id] }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Deleting somebody takes their expenses with them, so everyone else's share of
        // a bill they were part of would silently change. Named, because "somebody has a
        // balance" leaves you hunting for who.
        toast.error(
          data.error === "settle_first"
            ? t("manage.settleFirst", { names: (data.names ?? []).join(", ") })
            : data.error || t("manage.failed")
        );
        return;
      }

      await onChanged();
      toast.success(
        linked
          ? t("manage.memberReleased", { name: memberName })
          : t("manage.memberRemoved", { name: memberName })
      );
    } catch {
      toast.error(t("common.serverUnreachable"));
    } finally {
      setBusy(null);
    }
  };

  /** Handing the trip over. Two taps, because it cannot be taken back by the giver. */
  const [handingTo, setHandingTo] = useState<string | null>(null);

  const makeOwner = async (id: string, memberName: string) => {
    const ok = await call(
      `own-${id}`,
      `/api/trips/${tripId}`,
      { method: "PATCH", body: JSON.stringify({ transferOwner: id }) },
      t("manage.ownerChanged", { name: memberName })
    );
    if (ok) {
      setHandingTo(null);
      onOpenChange(false);
    }
  };

  const saveRename = async () => {
    if (!renaming?.value.trim()) return;
    const name = renaming.value.trim();
    // Not "trip renamed": this is a person's name in this trip, and saying the wrong one
    // back at somebody who just changed their own is how you make them undo it to check.
    const ok = await call(
      `rn-${renaming.id}`,
      `/api/trips/${tripId}`,
      { method: "PATCH", body: JSON.stringify({ renameMember: { id: renaming.id, name } }) },
      renaming.id === you ? t("manage.aliasSaved", { name }) : t("manage.memberRenamed", { name })
    );
    if (ok) setRenaming(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("manage.title")}</DialogTitle>
          <DialogDescription>{t("manage.subtitle")}</DialogDescription>
        </DialogHeader>

        {/* The trip itself is the owner's. Everyone else opens this dialog for the
            people list below, which is where they set what they are called here. */}
        {owner && (
          <>
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
                  {busy === "rename" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    t("common.save")
                  )}
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
                  {busy === "budget" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    t("common.save")
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("pace.budgetHint")}</p>
            </div>

            <Separator />
          </>
        )}

        <div className="space-y-2">
          <Label>{t("manage.people")}</Label>
          <ul className="space-y-1">
            {members.map((m) => {
              const mine = m.id === you;
              // Somebody the owner took out: their column and its figures stay, and it
              // stays theirs — so nobody can claim it, and inviting them back puts them
              // in it rather than starting a second one beside it.
              const gone = Boolean(m.userId) && m.inTrip === false;
              // Your own name is yours to set — that is the alias, and the whole reason
              // this dialog opens for everybody. The owner labels everyone who is not
              // here to speak for themselves; nobody else renames a person with an
              // account who is still in the trip.
              const canRename = mine || (owner && (!m.userId || gone));

              // Somebody with an account who is still here can be handed the trip, which
              // is the only way out of the owner being a single point of failure.
              const canTakeOver = owner && !mine && Boolean(m.userId) && !gone;

              if (handingTo === m.id) {
                return (
                  <li
                    key={m.id}
                    className="space-y-2 rounded-lg border border-primary/30 bg-primary/[0.06] p-2.5"
                  >
                    <p className="text-sm">{t("manage.makeOwnerConfirm", { name: m.name })}</p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="h-8 flex-1"
                        disabled={busy !== null}
                        onClick={() => makeOwner(m.id, m.name)}
                      >
                        {busy === `own-${m.id}` ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          t("manage.makeOwner")
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 flex-1"
                        onClick={() => setHandingTo(null)}
                      >
                        {t("common.cancel")}
                      </Button>
                    </div>
                  </li>
                );
              }

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
                      {/* The address only ever reaches the owner, and only where it
                          tells them something: which account a name belongs to. */}
                      {m.accountEmail && !mine && (
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {m.accountEmail}
                        </span>
                      )}
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
                  ) : gone ? (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {t("manage.leftTrip")}
                    </span>
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

                  {/* Taking somebody out of a trip is the owner's, like everything else
                      about the trip. Their own seat is not offered: a trip without its
                      owner in it has nobody who could put them back.

                      The first press on somebody who is here takes away their access and
                      leaves everything they spent; a second one, or the only one on a
                      name nobody is behind, deletes the column and its money with it. */}
                  {canTakeOver && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-foreground"
                      onClick={() => setHandingTo(m.id)}
                      disabled={busy !== null}
                      aria-label={`${t("manage.makeOwner")}: ${m.name}`}
                      title={t("manage.makeOwner")}
                    >
                      <Crown className="size-3.5" />
                    </Button>
                  )}

                  {owner && !mine && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      onClick={() => removeMember(m.id, m.name, Boolean(m.userId) && !gone)}
                      disabled={busy !== null}
                      aria-label={`${
                        Boolean(m.userId) && !gone ? t("manage.removeFromTrip") : t("common.delete")
                      }: ${m.name}`}
                    >
                      {busy === `rm-${m.id}` ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <X className="size-3.5" />
                      )}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>

          {/* What the X does depends on the person, and neither half is obvious: one is
              undoable by inviting them again, the other takes their expenses with it. */}
          {owner && <p className="text-xs text-muted-foreground">{t("manage.removeWarning")}</p>}

          {owner && (
            <>
              <div className="flex gap-2 pt-1">
                <Input
                  value={newMember}
                  onChange={(e) => setNewMember(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addPerson()}
                  placeholder={t("manage.addSomeone")}
                  className="h-10 min-w-0 flex-1"
                />
                <Button
                  variant="outline"
                  onClick={addPerson}
                  disabled={busy !== null || !newMember.trim()}
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
            </>
          )}

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

      </DialogContent>
    </Dialog>
  );
}
