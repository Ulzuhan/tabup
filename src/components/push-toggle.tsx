"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, BellOff } from "lucide-react";
import { useT } from "@/i18n/provider";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

/**
 * The public key arrives base64url; the subscribe call wants raw bytes.
 *
 * Built on an explicit ArrayBuffer rather than `Uint8Array.from`, whose type carries an
 * ArrayBufferLike that could in principle be shared memory — which `applicationServerKey`
 * will not take.
 */
function decodeKey(base64url: string): ArrayBuffer {
  const padded = base64url.padEnd(base64url.length + ((4 - (base64url.length % 4)) % 4), "=");
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Asking to be told things.
 *
 * Deliberately a menu item rather than a prompt on arrival: a permission dialog nobody
 * asked for is the fastest way to get it denied for good, and once denied the browser
 * gives no second chance. Somebody who wants to be told will come looking.
 *
 * The state is read from both sides. The browser knows whether it has a subscription and
 * whether permission was refused; the server knows whether it still has the row. Either
 * can be true without the other, and the toggle has to show what will actually happen.
 */
export function PushToggle({ variant = "menu" }: { variant?: "menu" | "row" }) {
  const t = useT();
  const [state, setState] = useState<"unavailable" | "off" | "on" | "denied" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const look = async () => {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
      ) {
        if (!cancelled) setState("unavailable");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setState("denied");
        return;
      }

      try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (!existing) {
          if (!cancelled) setState("off");
          return;
        }
        // A subscription this server has forgotten is not one that will ring.
        const res = await fetch(`/api/push?endpoint=${encodeURIComponent(existing.endpoint)}`);
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setState(data.subscribed ? "on" : "off");
      } catch {
        if (!cancelled) setState("off");
      }
    };

    look();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === null || state === "unavailable") return null;

  const turnOn = async () => {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }

      const { publicKey } = await fetch("/api/push").then((r) => r.json());
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        // Silent pushes are not allowed on the web, and asking for them gets the
        // subscription rejected outright.
        userVisibleOnly: true,
        applicationServerKey: decodeKey(publicKey),
      });

      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      if (!res.ok) throw new Error("save failed");

      setState("on");
      toast.success(t("push.on"));
    } catch {
      toast.error(t("push.failed"));
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setState("off");
      toast.success(t("push.off"));
    } catch {
      toast.error(t("push.failed"));
    } finally {
      setBusy(false);
    }
  };

  const Icono = state === "on" ? BellOff : Bell;
  const etiqueta = state === "on" ? t("push.turnOff") : t("push.turnOn");

  // Fuera de un menú —en los ajustes— tiene que ser un botón normal: un elemento de
  // menú suelto no es pulsable con teclado ni se anuncia como lo que es.
  if (variant === "row") {
    if (state === "denied") {
      return (
        <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
          <BellOff className="size-4" />
          {t("push.blocked")}
        </p>
      );
    }
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => (state === "on" ? turnOff() : turnOn())}
        className="flex w-full items-center gap-2 rounded-lg px-4 py-3 text-left text-sm transition-colors hover:bg-secondary disabled:opacity-60"
      >
        <Icono className="size-4" />
        {etiqueta}
      </button>
    );
  }

  if (state === "denied") {
    return (
      <DropdownMenuItem disabled>
        <BellOff className="size-4" />
        {t("push.blocked")}
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuItem
      disabled={busy}
      onClick={(event) => {
        // The menu would close under the permission dialog otherwise, and on some
        // browsers that cancels the request.
        event.preventDefault();
        if (state === "on") turnOff();
        else turnOn();
      }}
    >
      <Icono className="size-4" />
      {etiqueta}
    </DropdownMenuItem>
  );
}
