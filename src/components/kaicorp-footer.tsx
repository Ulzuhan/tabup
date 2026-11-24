import Link from "next/link";

/**
 * Pie común de KaiCorp Labs.
 *
 * GENERADO — se copia desde el repo `kaicorplabs` con `tools/sync-theme.sh`.
 * No editar aquí: editar el original y sincronizar.
 */
const SERVICES = [
  { name: "TabUp", url: "https://tabup.kaicorplabs.com", slug: "tabup" },
  { name: "QR-Forge", url: "https://qr.kaicorplabs.com", slug: "qr-forge" },
  { name: "DocDrop", url: "https://docdrop.kaicorplabs.com", slug: "docdrop" },
  { name: "SecretDrop", url: "https://secret.kaicorplabs.com", slug: "secretdrop" },
  { name: "Pixelforge", url: "https://pixel.kaicorplabs.com", slug: "pixelforge" },
  { name: "LinkUp", url: "https://link.kaicorplabs.com", slug: "linkup" },
];

export function KaiCorpFooter({
  current,
  showLinks,
}: {
  current?: string;
  showLinks?: boolean;
}) {
  const links =
    showLinks ??
    (typeof process !== "undefined" ? Boolean(process.env?.KAICORP_FOOTER_LINKS?.trim()) : false);

  return (
    <footer
      className="mt-auto border-t px-4 py-5 sm:px-6"
      style={{
        borderColor: "var(--kc-line)",
        background: "var(--kc-bg)",
        fontFamily: "var(--kc-font-sans)",
      }}
    >
      <div className="mx-auto flex w-full max-w-[74rem] flex-col items-center gap-3 text-center sm:flex-row sm:justify-between sm:text-left">
        <Link
          href="https://kaicorplabs.com"
          className="flex items-center gap-2 text-xs transition-opacity hover:opacity-80"
          style={{ color: "var(--kc-text-2)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/kaicorp-mark.png" alt="" width={18} height={18} className="block size-[18px]" />
          <span>
            Built by{" "}
            <span style={{ color: "var(--kc-text-1)", fontWeight: 500 }}>KaiCorp Labs</span>
          </span>
        </Link>

        {links && (
          <nav
            aria-label="KaiCorp Labs services"
            className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs"
          >
            {SERVICES.map((s) =>
              s.slug === current ? (
                <span key={s.slug} aria-current="page" className="kc-footer-current">
                  {s.name}
                </span>
              ) : (
                <a
                  key={s.slug}
                  href={s.url}
                  className="transition-colors hover:opacity-100"
                  style={{ color: "var(--kc-text-2)" }}
                >
                  {s.name}
                </a>
              )
            )}
            <span className="kc-footer-sep" aria-hidden="true">
              ·
            </span>
            <a
              href="https://account.kaicorplabs.com/"
              className="transition-colors hover:opacity-100"
              style={{ color: "var(--kc-text-2)" }}
            >
              Account
            </a>
            <a
              href="https://kaicorplabs.com/privacy/"
              className="transition-colors hover:opacity-100"
              style={{ color: "var(--kc-text-2)" }}
            >
              Privacy
            </a>
          </nav>
        )}
      </div>
    </footer>
  );
}
