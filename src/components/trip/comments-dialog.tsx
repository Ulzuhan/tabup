"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Send, Trash2 } from "lucide-react";
import { useServerError, useT, useIntlLocale } from "@/i18n/provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Comment {
  id: string;
  authorName: string;
  body: string;
  createdAt: number;
  mine: boolean;
}

/**
 * What people say about an expense, as opposed to what they do to it.
 *
 * This is the counterweight to the permission model. Somebody who thinks a figure is
 * wrong has two ways to act on it: change it, which rewrites what another person
 * recorded about their own money, or say so. Only the first needs permission — and an
 * app that offers only the first is one where people quietly overwrite each other, which
 * is what Splitwise gets complained at for daily.
 *
 * Open to everyone in the trip, deliberately: the person who cannot edit is precisely
 * the one who needs a way to speak.
 */
export function CommentsDialog({
  open,
  onOpenChange,
  tripId,
  expense,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tripId: string;
  expense: { id: string; description: string } | null;
  onChanged: () => void;
}) {
  const t = useT();
  const serverError = useServerError();
  const locale = useIntlLocale();
  /**
   * Held with the expense it belongs to rather than cleared on the way in.
   *
   * Resetting to null in the effect would be a setState during the render pass, and
   * comparing ids gives the same "loading" state for free: a thread fetched for another
   * expense is simply not this one's.
   */
  const [loaded, setLoaded] = useState<{ expenseId: string; comments: Comment[] } | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const expenseId = expense?.id;
  const comments = loaded && loaded.expenseId === expenseId ? loaded.comments : null;

  useEffect(() => {
    if (!open || !expenseId) return;
    let cancelled = false;
    fetch(`/api/trips/${tripId}/comment?expenseId=${encodeURIComponent(expenseId)}`)
      .then((res) => (res.ok ? res.json() : { comments: [] }))
      .then((data) => !cancelled && setLoaded({ expenseId, comments: data.comments ?? [] }))
      .catch(() => !cancelled && setLoaded({ expenseId, comments: [] }));
    return () => {
      cancelled = true;
    };
  }, [open, tripId, expenseId]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !expenseId || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expenseId, body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(serverError(data, "comments.failed"));
        return;
      }
      setLoaded((current) =>
        current && current.expenseId === expenseId
          ? { ...current, comments: [...current.comments, data.comment] }
          : current
      );
      setDraft("");
      // The list shows a count next to each expense, and it has just moved.
      onChanged();
    } catch {
      toast.error(t("common.serverUnreachable"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (commentId: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/comment`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(serverError(data, "comments.failed"));
        return;
      }
      setLoaded((current) =>
        current
          ? { ...current, comments: current.comments.filter((c) => c.id !== commentId) }
          : current
      );
      toast.success(t("comments.deleted"));
      onChanged();
    } catch {
      toast.error(t("common.serverUnreachable"));
    } finally {
      setBusy(false);
    }
  };

  const when = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("comments.title")}</DialogTitle>
          <DialogDescription>
            {t("comments.open", { name: expense?.description ?? "" })}
          </DialogDescription>
        </DialogHeader>

        {comments === null ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : comments.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-8 text-center">
            <p className="text-sm font-medium">{t("comments.empty")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("comments.emptyHint")}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {comments.map((comment) => (
              <li key={comment.id} className="group rounded-xl bg-secondary/40 p-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-medium">{comment.authorName}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {when.format(new Date(comment.createdAt))}
                  </span>
                  {comment.mine && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-destructive max-sm:opacity-100"
                      onClick={() => remove(comment.id)}
                      disabled={busy}
                      aria-label={`${t("common.delete")}: ${comment.body.slice(0, 20)}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
                <p className="mt-0.5 text-sm break-words whitespace-pre-wrap">{comment.body}</p>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={t("comments.placeholder")}
            maxLength={500}
            className="h-10 min-w-0 flex-1"
            aria-label={t("comments.placeholder")}
          />
          <Button onClick={send} disabled={busy || !draft.trim()} className="h-10 shrink-0">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            <span className="sr-only">{t("comments.send")}</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
