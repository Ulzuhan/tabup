"use client";

import { useEffect, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { useT, useIntlLocale } from "@/i18n/provider";
import { EmptyPanel } from "./empty-panel";

export interface ActivityEntry {
  id: string;
  actorName: string;
  action: string;
  subject: string | null;
  createdAt: number;
}

/**
 * Every action maps to one sentence, and the map is explicit.
 *
 * Built as a lookup rather than by interpolating the action into a key, so a line the
 * server starts writing without a translation to go with it fails at compile time
 * instead of showing a raw key to somebody.
 */
const SENTENCES = {
  expenseAdded: "activity.expenseAdded",
  expenseEdited: "activity.expenseEdited",
  expenseDeleted: "activity.expenseDeleted",
  paymentAdded: "activity.paymentAdded",
  paymentDeleted: "activity.paymentDeleted",
  commentAdded: "activity.commentAdded",
  memberAdded: "activity.memberAdded",
  memberInvited: "activity.memberInvited",
  memberReturned: "activity.memberReturned",
  memberJoined: "activity.memberJoined",
  memberClaimed: "activity.memberClaimed",
  memberLeft: "activity.memberLeft",
  memberDeleted: "activity.memberDeleted",
  memberRenamed: "activity.memberRenamed",
  tripRenamed: "activity.tripRenamed",
  tripBudget: "activity.tripBudget",
  tripBudgetCleared: "activity.tripBudgetCleared",
  tripOwner: "activity.tripOwner",
} as const;

/**
 * Who did what, newest first.
 *
 * The permission model says each person answers for what they entered and the owner can
 * change anything. Neither half is worth much unless it can be seen — a rule about
 * responsibility that leaves no trace is a promise, not a record, and the owner's power
 * to rewrite anybody's figures is exactly the thing that should not be silent.
 *
 * Fetched when the tab is opened rather than with the trip: it is a page nobody looks at
 * most days, and folding it into every trip read would put it in the offline cache of
 * every device on every load.
 */
export function ActivityFeed({ tripId }: { tripId: string }) {
  const t = useT();
  const locale = useIntlLocale();
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/trips/${tripId}/activity`)
      .then((res) => (res.ok ? res.json() : { entries: [] }))
      .then((data) => !cancelled && setEntries(data.entries ?? []))
      .catch(() => !cancelled && setEntries([]));
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  if (entries === null) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyPanel
        icon={<History className="size-5 text-muted-foreground" />}
        title={t("trip.noActivity")}
        hint={t("trip.noActivityHint")}
      />
    );
  }

  const when = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <ul className="space-y-1.5">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex items-baseline gap-3 rounded-xl border border-border bg-card px-3 py-2.5"
        >
          <p className="min-w-0 flex-1 text-[13px] leading-relaxed">
            {t(SENTENCES[entry.action as keyof typeof SENTENCES] ?? "activity.unknown", {
              actor: entry.actorName,
              subject: entry.subject ?? "",
            })}
          </p>
          <span className="shrink-0 text-[11px] whitespace-nowrap text-muted-foreground">
            {when.format(new Date(entry.createdAt))}
          </span>
        </li>
      ))}
    </ul>
  );
}
