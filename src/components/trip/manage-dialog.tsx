"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Mail, Trash2, UserPlus, X } from "lucide-react";
import type { Member } from "@/lib/types";
import { MemberAvatar } from "@/components/member-avatar";
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
  members: Member[];
  collaborators: Collaborator[];
  access: "viewer" | "editor" | "owner";
  anonymous: boolean;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState(tripName);
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
        toast.error(data.error || "That did not work");
        return false;
      }
      await onChanged();
      toast.success(success);
      return true;
    } catch {
      toast.error("Could not reach the server");
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
    }, "Trip renamed");
  };

  const addMember = async () => {
    const trimmed = newMember.trim();
    if (!trimmed) return;
    const ok = await call("add", `/api/trips/${tripId}`, {
      method: "PATCH",
      body: JSON.stringify({ addMembers: [trimmed] }),
    }, "Member added");
    if (ok) setNewMember("");
  };

  const removeMember = async (id: string, memberName: string) => {
    await call(`rm-${id}`, `/api/trips/${tripId}`, {
      method: "PATCH",
      body: JSON.stringify({ removeMembers: [id] }),
    }, `${memberName} removed`);
  };

  const invite = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    const ok = await call("invite", `/api/trips/${tripId}/share`, {
      method: "POST",
      body: JSON.stringify({ email: trimmed, role }),
    }, "Access granted");
    if (ok) setEmail("");
  };

  const revoke = async (userId: string) => {
    await call(`revoke-${userId}`, `/api/trips/${tripId}/share`, {
      method: "DELETE",
      body: JSON.stringify({ userId }),
    }, "Access revoked");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Trip settings</DialogTitle>
          <DialogDescription>Name, who is in it, and who can open it.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="trip-rename">Name</Label>
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
              {busy === "rename" ? <Loader2 className="size-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <Label>People in this trip</Label>
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
                  aria-label={`Remove ${m.name}`}
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
            Removing someone deletes their expenses and payments too.
          </p>

          <div className="flex gap-2 pt-1">
            <Input
              value={newMember}
              onChange={(e) => setNewMember(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addMember()}
              placeholder="Add someone"
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
              <Label>Accounts with access</Label>

              {anonymous ? (
                <p className="rounded-lg border border-border bg-secondary/40 p-2.5 text-xs text-muted-foreground">
                  This trip belongs to nobody, so anyone with the link can open it. Claim it
                  to an account first if you want to choose who gets in.
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
                            aria-label={`Revoke access for ${c.email}`}
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
                        <SelectItem value="editor">Editor</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      onClick={invite}
                      disabled={busy !== null || !email.trim()}
                      className="shrink-0"
                    >
                      {busy === "invite" ? <Loader2 className="size-4 animate-spin" /> : "Invite"}
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    They need an account here already. Editors can add and edit expenses;
                    viewers can only look.
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
