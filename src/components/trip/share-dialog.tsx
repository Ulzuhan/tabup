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
 * For an anonymous trip the link is the credential, so this says as much rather than
 * letting someone hand it around assuming it is private.
 */
export function ShareDialog({
  open,
  onOpenChange,
  url,
  tripId,
  tripName,
  summary,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  tripId: string;
  tripName: string;
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

  /**
   * What the QR and the copy button actually hand over.
   *
   * The plain URL is useless to anyone else: every trip belongs to an account, so a
   * stranger opening it gets a 404. An invitation link is the only thing worth handing
   * over, and it replaces the URL here as soon as one exists.
   */
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const shareUrl = inviteUrl ?? url;

  const createInvite = async () => {
    setCreatingInvite(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/invite`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setInviteUrl(`${window.location.origin}/join/${data.token}`);
      }
    } catch {
      /* the plain link stays on screen; it still works for anyone already invited */
    } finally {
      setCreatingInvite(false);
    }
  };
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is denied outside a secure context; the link is on screen and
      // selectable, so there is still a way through.
    }
  };

  const nativeShare = async () => {
    try {
      await navigator.share({ title: tripName, url: shareUrl });
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
            {t("shareTrip.subtitle")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-center">
          <div className="rounded-2xl bg-white p-3">
            <QrCode value={shareUrl} className="size-48" label={t("shareTrip.title")} />
          </div>
        </div>

        {/* min-w-0 on this row too: DialogContent is a grid, and grid children default
            to min-width:auto, so without it the long URL sets the width of the whole
            dialog and `truncate` never gets a chance to apply. */}
        <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-secondary/50 p-2">
          <span className="min-w-0 flex-1 truncate pl-1 font-mono text-xs text-muted-foreground">
            {shareUrl}
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

        {!inviteUrl && (
          <div className="space-y-2 rounded-xl border border-warning/25 bg-warning/[0.06] p-3">
            <p className="text-xs text-muted-foreground">{t("join.inviteHint")}</p>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={createInvite}
              disabled={creatingInvite}
            >
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
        )}

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
