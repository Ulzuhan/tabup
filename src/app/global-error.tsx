"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#141520",
          color: "#f4f6fb",
          fontFamily: "system-ui, sans-serif",
          padding: "2rem",
        }}
      >
        <main style={{ maxWidth: "24rem", textAlign: "center" }}>
          <p style={{ fontSize: "0.85rem", letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.65 }}>
            500
          </p>
          <h1 style={{ fontSize: "1.35rem", fontWeight: 600, margin: "0.4rem 0 0.6rem" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "0.95rem", opacity: 0.78, margin: "0 0 1.5rem" }}>
            An unexpected error occurred while loading TabUp.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                padding: "0.6rem 1.1rem",
                borderRadius: "0.6rem",
                border: "none",
                background: "#45e0f5",
                color: "#05070d",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                padding: "0.6rem 1.1rem",
                borderRadius: "0.6rem",
                border: "1px solid rgba(255,255,255,0.2)",
                color: "#f4f6fb",
                textDecoration: "none",
              }}
            >
              Go home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
