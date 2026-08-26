"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Download,
  MoreVertical,
  Settings,
  Share2,
  Trash2,
  UserPlus,
} from "lucide-react";
import type { Member } from "@/lib/types";
import { useT } from "@/i18n/provider";
import { MemberStack } from "@/components/member-avatar";
import { LanguageItems } from "@/components/language";
import { ThemeItems } from "@/components/theme";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Name, who is on the trip, and the way out of every other thing you can do to it. */
export function TripHeader({
  tripId,
  name,
  members,
  access,
  onManage,
  onShare,
  onDelete,
}: {
  tripId: string;
  name: string;
  members: Member[];
  access: "member" | "owner";
  onManage: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const t = useT();

  return (
    <header className="mb-6 flex items-start gap-3 pt-1">
      <Button
        variant="ghost"
        size="icon"
        className="-ml-2 shrink-0 text-muted-foreground"
        render={
          <Link href="/" aria-label={t("common.back")}>
            <ArrowLeft className="size-5" />
          </Link>
        }
      />

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-semibold tracking-tight">{name}</h1>
        <div className="mt-2 flex items-center gap-2.5">
          <MemberStack members={members} />
          {/* Open to everyone in the trip, not only the owner: this is also where a
              person sets what they are called here, which was never the owner's to
              decide. What they may change inside depends on whose it is. */}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs text-muted-foreground"
            onClick={onManage}
          >
            <UserPlus className="size-3.5" />
            {t("trip.manage")}
          </Button>
        </div>
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="shrink-0"
        onClick={onShare}
        aria-label={t("common.share")}
      >
        <Share2 className="size-4" />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" className="shrink-0" aria-label={t("trip.settings")}>
              <MoreVertical className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onManage}>
            <Settings className="size-4" />
            {t("trip.settings")}
          </DropdownMenuItem>
          <DropdownMenuItem render={<a href={`/api/trips/${tripId}/export`} download />}>
            <Download className="size-4" />
            {t("trip.exportCsv")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* The trip screen has its own header, so without this the language picker
              would only exist on the home screen. */}
          <LanguageItems />
          <DropdownMenuSeparator />
          <ThemeItems />
          {access === "owner" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 className="size-4" />
                {t("trip.deleteTrip")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
