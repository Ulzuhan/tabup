import Link from "next/link";
import { KaiCorpAppSwitcher } from "./kaicorp-app-switcher";

/**
 * Cabecera común de KaiCorp Labs.
 *
 * GENERADO — se copia desde el repo `kaicorplabs` con `tools/sync-theme.sh`.
 * No editar aquí: editar el original y sincronizar.
 *
 * El icono + nombre de la herramienta siempre llevan a `/` de la propia app.
 * El selector de aplicaciones (3×3) a su izquierda permite saltar a otras
 * herramientas o a `kaicorplabs.com` / `account.kaicorplabs.com` cuando el
 * despliegue lo activa (`KAICORP_FOOTER_LINKS`).
 */
export function KaiCorpHeader({
  app,
  current,
  showSwitcher = false,
  signedIn = false,
  children,
}: {
  /** Nombre del servicio, a la derecha de la marca. */
  app: string;
  /** Identificador de la herramienta actual dentro del selector de apps. */
  current?: string;
  /** Muestra el selector de aplicaciones KaiCorp Labs junto a la marca. */
  showSwitcher?: boolean;
  /** Si el usuario tiene sesión activa, añade /?sso=1 al saltar entre herramientas. */
  signedIn?: boolean;
  /** Acciones de la app: menú de cuenta, ajustes, entrar, etc. */
  children?: React.ReactNode;
}) {
  return (
    <header
      className="sticky top-0 z-40 border-b backdrop-blur"
      style={{
        borderColor: "var(--kc-line)",
        background: "color-mix(in oklab, var(--kc-bg) 78%, transparent)",
      }}
    >
      <div className="mx-auto flex h-[60px] w-full max-w-[74rem] items-center gap-3 px-4 sm:px-6">
        {showSwitcher && <KaiCorpAppSwitcher current={current} signedIn={signedIn} />}

        <Link
          href="/"
          className="flex min-w-0 items-center gap-2.5 transition-opacity hover:opacity-80"
          title={app}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/kaicorp-mark.png" alt="" width={26} height={26} className="block size-[26px] shrink-0" />
          <span
            className="truncate text-[16px] font-semibold tracking-tight"
            style={{ color: "var(--kc-text-1)", fontFamily: "var(--kc-font-display)" }}
          >
            {app}
          </span>
        </Link>

        {children && <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>}
      </div>
    </header>
  );
}
