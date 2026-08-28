"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { Member } from "@/lib/types";
import { MemberAvatar } from "@/components/member-avatar";
import { useServerError, useT } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * "Which of these is you?"
 *
 * Shown to somebody who can open a trip but is in nobody's split. Being able to read a
 * trip and being one of the people it divides its bills between were never the same
 * thing, and until now only the first was modelled — so somebody let into a trip could
 * add expenses while the app had no idea which column was theirs, and every balance had
 * to be read as a list of names rather than as what *you* owe.
 *
 * It asks instead of guessing. The names were typed by whoever created the trip, and
 * matching "Andoni" to an account by spelling would be a guess about money. It is also
 * how trips made before any of this get their members attached to real people: all of
 * them are bare text, and nothing else would ever link them.
 */
export function ClaimPrompt({
  tripId,
  candidates,
  onClaimed,
}: {
  tripId: string;
  candidates: Member[];
  onClaimed: () => Promise<void>;
}) {
  const t = useT();
  const serverError = useServerError();
  const [busy, setBusy] = useState<string | null>(null);
  /** Null until they say none of the names is theirs; then it holds the alias they type. */
  const [alias, setAlias] = useState<string | null>(null);

  const claim = async (body: { memberId?: string; create?: boolean; name?: string }, key: string) => {
    setBusy(key);
    try {
      const res = await fetch(`/api/trips/${tripId}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(serverError(data, "claim.failed"));
        return;
      }
      await onClaimed();
      toast.success(t("claim.done", { name: data.member?.name ?? "" }));
    } catch {
      toast.error(t("common.serverUnreachable"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="gap-3 border-dashed p-4">
      <div>
        <p className="text-sm font-medium">{t("claim.title")}</p>
        <p className="text-xs text-muted-foreground">{t("claim.hint")}</p>
      </div>

      {candidates.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {candidates.map((m) => (
            <Button
              key={m.id}
              variant="outline"
              size="sm"
              className="h-9 gap-2"
              disabled={busy !== null}
              onClick={() => claim({ memberId: m.id }, m.id)}
            >
              {busy === m.id ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <MemberAvatar emoji={m.emoji} size="sm" />
              )}
              {m.name}
            </Button>
          ))}
        </div>
      )}

      {/* Nobody on the list is them — a trip they were invited into after it started, or
          one whose members were all typed before they arrived. They join as themselves,
          and get to say what they are called here while they are at it: the alias is the
          point of linking to an account rather than being labelled by one. */}
      {alias === null ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-muted-foreground"
          disabled={busy !== null}
          onClick={() => setAlias("")}
        >
          {candidates.length > 0 ? t("claim.noneOfThese") : t("claim.addMe")}
        </Button>
      ) : (
        <div className="flex gap-2">
          <Input
            autoFocus
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && claim({ create: true, name: alias }, "new")}
            placeholder={t("claim.aliasPlaceholder")}
            className="h-9 min-w-0 flex-1"
            aria-label={t("claim.aliasPlaceholder")}
          />
          <Button
            size="sm"
            className="h-9 shrink-0"
            disabled={busy !== null}
            onClick={() => claim({ create: true, name: alias }, "new")}
          >
            {busy === "new" ? <Loader2 className="size-3.5 animate-spin" /> : t("claim.join")}
          </Button>
        </div>
      )}
    </Card>
  );
}
