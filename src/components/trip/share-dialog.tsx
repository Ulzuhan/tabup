"use client";

import { useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { Check, Copy, Share2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/provider";
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
  tripName,
  anonymous,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  tripName: string;
  anonymous: boolean;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is denied outside a secure context; the link is on screen and
      // selectable, so there is still a way through.
    }
  };

  const nativeShare = async () => {
    try {
      await navigator.share({ title: tripName, url });
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
            <QrCode value={url} className="size-48" label={t("shareTrip.title")} />
          </div>
        </div>

        {/* min-w-0 on this row too: DialogContent is a grid, and grid children default
            to min-width:auto, so without it the long URL sets the width of the whole
            dialog and `truncate` never gets a chance to apply. */}
        <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-secondary/50 p-2">
          <span className="min-w-0 flex-1 truncate pl-1 font-mono text-xs text-muted-foreground">
            {url}
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

        {anonymous && (
          <p className="flex gap-2 text-xs text-muted-foreground">
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" />
            <span>{t("shareTrip.anonymousWarning")}</span>
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
