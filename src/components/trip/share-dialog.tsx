"use client";

import { useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { Check, Copy, FileText, ImageDown, Loader2, Share2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT, useIntlLocale } from "@/i18n/provider";
import { renderSummary, canvasToBlob } from "./summary-image";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Renders the link as an SVG QR code.
 *
 * SVG rather than canvas so it stays sharp on any screen and prints correctly, and one
 * `<path>` for the whole thing rather than a rect per module — a trip URL comes out
 * around 33×33, and a thousand DOM nodes to draw a square is a waste.
 */
function QrCode({ value, className, label }: { value: string; className?: string; label: string }) {
  const { path, size } = useMemo(() => {
    // Type 0 lets the library pick the smallest version that fits; level M survives a
    // camera at an angle across a table, which is the actual use.
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();

    const count = qr.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
      }
    }
    return { path: d, size: count };
  }, [value]);

  return (
    <svg
      viewBox={`-1 -1 ${size + 2} ${size + 2}`}
      className={className}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
    >
      {/* The quiet zone is part of the spec — scanners need the margin to find it. */}
      <rect x="-1" y="-1" width={size + 2} height={size + 2} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}

/**
 * Sharing a trip.
 *
 * There is exactly one link here, and it is the invitation.
 *
 * This used to open on a QR of the trip's own URL, with the invitation offered
 * separately below — two codes, two links, and no way to tell from looking which one
 * a person should send. The plain URL was the wrong one every time: every trip belongs
 * to an account, so anybody who did not already have access got a 404 from it, and
 * anybody who did have access already had the trip in their list and needed no link at
 * all. So it is gone, and the QR now appears only once there is something worth
 * scanning.
 */
export function ShareDialog({
  open,
  onOpenChange,
  url,
  tripId,
  tripName,
  canInvite,
  summary,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  tripId: string;
  tripName: string;
  /** Who comes into a trip is the owner's call; the summary below is everyone's. */
  canInvite: boolean;
  summary: {
    currency: string;
    total: number;
    expenseCount: number;
    balances: { name: string; emoji: string; balance: number }[];
    settlements: { fromName: string; toName: string; amount: number }[];
  };
}) {
  const t = useT();
  const locale = useIntlLocale();
  const { build, busy } = useSummaryImage();

  /** Nothing to scan, copy or share until this exists. */
  const [invite, setInvite] = useState<{ url: string; expiresAt: number } | null>(null);
  const [creatingInvite, setCreatingInvite] = useState(false);

  const createInvite = async () => {
    setCreatingInvite(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/invite`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setInvite({
          url: `${window.location.origin}/join/${data.token}`,
          expiresAt: data.expiresAt,
        });
      }
    } catch {
      /* the button stays on screen, so it can simply be pressed again */
    } finally {
      setCreatingInvite(false);
    }
  };
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is denied outside a secure context; the link is on screen and
      // selectable, so there is still a way through.
    }
  };

  const nativeShare = async () => {
    if (!invite) return;
    try {
      await navigator.share({ title: tripName, url: invite.url });
    } catch {
      // Includes the user simply dismissing the sheet, which is not an error.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("shareTrip.title")}</DialogTitle>
          <DialogDescription>
            {invite ? t("shareTrip.subtitle") : t("shareTrip.subtitleNew")}
          </DialogDescription>
        </DialogHeader>

        {invite ? (
          <>
            <div className="flex justify-center">
              <div className="rounded-2xl bg-white p-3">
                <QrCode value={invite.url} className="size-48" label={t("shareTrip.title")} />
              </div>
            </div>

            {/* What the code does, right next to the code: one QR looks exactly like
                another, and this one puts whoever scans it into the split. */}
            <div className="text-center text-xs text-muted-foreground">
              <p>{t("join.inviteHint")}</p>
              <p className="mt-0.5">
                {t("join.inviteExpires", {
                  date: new Intl.DateTimeFormat(locale, {
                    day: "numeric",
                    month: "long",
                  }).format(new Date(invite.expiresAt)),
                })}
              </p>
            </div>

            {/* min-w-0 on this row: DialogContent is a grid, and grid children default
                to min-width:auto, so without it the long URL sets the width of the whole
                dialog and `truncate` never gets a chance to apply. */}
            <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-secondary/50 p-2">
              <span className="min-w-0 flex-1 truncate pl-1 font-mono text-xs text-muted-foreground">
                {invite.url}
              </span>
              <Button size="sm" variant="ghost" onClick={copy} className="shrink-0">
                {copied ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}
                {copied ? t("common.copied") : t("common.copy")}
              </Button>
            </div>

            {typeof navigator !== "undefined" && "share" in navigator && (
              <Button variant="outline" onClick={nativeShare} className="w-full">
                <Share2 className="size-4" />
                {t("common.share")}
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-muted-foreground"
              onClick={() => setInvite(null)}
            >
              {t("join.inviteAnother")}
            </Button>
          </>
        ) : canInvite ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t("join.inviteHint")}</p>

            <Button className="h-11 w-full" onClick={createInvite} disabled={creatingInvite}>
              {creatingInvite ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <UserPlus className="size-4" />
                  {t("join.createInvite")}
                </>
              )}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("join.ownerInvites")}</p>
        )}

        <div className="space-y-2 rounded-xl border border-border p-3">
          <div>
            <p className="text-sm font-medium">{t("shareTrip.summary")}</p>
            <p className="text-xs text-muted-foreground">{t("shareTrip.summaryHint")}</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              disabled={busy}
              onClick={() =>
                build(
                  {
                    tripName,
                    locale,
                    labels: {
                      total: t("trip.totalSpent"),
                      settlements: t("trip.settleUp"),
                      allSettled: t("trip.allSettled"),
                      expenses: t("trip.expenses").toLowerCase(),
                    },
                    ...summary,
                  },
                  `${tripName.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase() || "tabup"}.png`
                )
              }
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ImageDown className="size-4" />}
              {typeof navigator !== "undefined" && "canShare" in navigator
                ? t("shareTrip.shareImage")
                : t("shareTrip.saveImage")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              render={
                <a href={`${url.split("?")[0]}/print`} target="_blank" rel="noreferrer">
                  <FileText className="size-4" />
                  PDF
                </a>
              }
            />
          </div>
        </div>

      </DialogContent>
    </Dialog>
  );
}

/**
 * Builds the summary image and hands it to the share sheet, or downloads it.
 *
 * `navigator.share` with a file is what puts it straight into WhatsApp on a phone;
 * where that is unavailable — desktop, mostly — a download is the honest fallback.
 */
export function useSummaryImage() {
  const [busy, setBusy] = useState(false);

  const build = async (input: Parameters<typeof renderSummary>[0], filename: string) => {
    setBusy(true);
    try {
      const canvas = renderSummary(input);
      const blob = await canvasToBlob(canvas);
      if (!blob) return;

      const file = new File([blob], filename, { type: "image/png" });

      if (
        typeof navigator !== "undefined" &&
        "canShare" in navigator &&
        navigator.canShare?.({ files: [file] })
      ) {
        await navigator.share({ files: [file], title: input.tripName }).catch(() => {});
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      // Revoking in the same tick can cancel the download before the browser has read
      // the blob — the click only queues it.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } finally {
      setBusy(false);
    }
  };

  return { build, busy };
}
