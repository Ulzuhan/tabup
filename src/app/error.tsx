"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { useLocale } from "@/i18n/provider";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = useLocale();
  const isEs = locale === "es";

  useEffect(() => {
    console.error("TabUp error:", error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="text-center">
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-secondary">
          <AlertTriangle className="size-7 text-muted-foreground" aria-hidden="true" />
        </div>

        <p className="text-sm font-medium tracking-wider text-muted-foreground uppercase">500</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          {isEs ? "Algo ha fallado" : "Something went wrong"}
        </h1>
        <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
          {isEs
            ? "No se ha podido cargar esta página ahora mismo."
            : "This page could not be loaded right now."}
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-muted-foreground">ref {error.digest}</p>
        )}

        <div className="mt-7 flex justify-center gap-3">
          <Button onClick={reset}>
            <RotateCcw className="size-4" />
            {isEs ? "Reintentar" : "Try again"}
          </Button>
          <Button variant="outline" render={<Link href="/">{isEs ? "Ir al inicio" : "Go home"}</Link>} />
        </div>
      </div>
    </div>
  );
}
