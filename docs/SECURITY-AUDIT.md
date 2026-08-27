# Security and infrastructure audit

Last re-audited: 2026-08-27.

## Scope and threat model

This audit treats TabUp as Internet-facing. It covers every App Router API handler,
authentication and OIDC, object-level authorization, SQLite and filesystem state,
receipt upload/OCR, push endpoints, CSV export, browser headers, CI, backup/restore and
all executable test suites. Attackers may be anonymous, normal users, members of a
different trip, concurrent callers, or control another origin including a sibling host.

Source, README.md, .github/workflows/ci.yml, scripts/, and the installed Next.js 16
documentation were reviewed. Live TLS, tunnel, firewall and reverse-proxy configuration
is outside this repository and must be checked on the host.

## Findings and disposition

Fixed in this audit:

1. Multipart receipt upload accepted a simple cross-origin POST. A sibling application
   could receive the SameSite cookie and force image decoding, disk writes and OCR.
   Fetch Metadata and Origin are now checked.
2. Logout had the same simple-POST gap and could be forced cross-origin. It now uses the
   same guard and preserves the session when rejecting a request.
3. Security notes claimed scrypt N=16384; code uses N=32768, r=8, p=3. Corrected.
4. Security notes called CSP non-nonce-based although src/proxy.ts creates a per-request
   nonce. Corrected.
5. Test counts were updated after adding three CSRF regression assertions.

Found while re-checking that work, and fixed:

6. The origin check preferred X-Forwarded-Host over Host. That header is written by
   the caller and **this deployment does not replace it** — verified live against the
   tunnel: `X-Forwarded-Host: malo.example` arrived untouched while Host still read
   `tabup.kaicorplabs.com`. Sending it alongside a matching Origin made the check pass
   and destroyed the session, so the control bypassed itself. Host is now the source of
   truth, with `TABUP_PUBLIC_HOST` for proxies that rewrite it.
7. `POST /api/trips/[id]/invite` was the third route that accepts a simple request. It
   reads no body, so the application/json requirement does not cover it, and it had no
   guard: a sibling origin got 200 and minted an invite for somebody else's trip. The
   link itself is not readable cross-origin, but the minting was unbounded.

Re-audited controls:

- Sessions use 256-bit random values, store only SHA-256 digests, expire, and use
  HttpOnly, Secure-in-production and SameSite=Lax cookies.
- Passwords use salted scrypt. Login does a dummy hash for unknown accounts and
  throttles by account plus the available proxy-provided address.
- OIDC uses authorization code, PKCE, state, bounded timeouts and safe relative redirects.
- Every trip and nested row is object-authorized. Hidden trips return 404. Admin page and
  APIs independently enforce the role.
- JSON mutations require application/json. The three simple requests — logout, receipt
  upload and invite — require same origin. CSV formula prefixes are neutralized.
- Receipts are size-capped, decoded/re-encoded, stripped of metadata before storage/OCR,
  path-constrained, access-controlled and private-cache only.
- Race-sensitive SQLite writes use constraints/transactions. Online backups are
  integrity-checked before retention.
- CSP, clickjacking, MIME, referrer and permissions headers are present; framework
  disclosure is disabled.
- npm audit --omit=dev reports zero known production vulnerabilities.

## Internet-facing deployment requirements

- Terminate TLS at a maintained reverse proxy, redirect HTTP, and do not expose the
  Next.js listener directly.
- Replace inbound X-Forwarded-For and X-Real-IP. TabUp trusts them for throttling, and
  a caller that can forge them evades the per-address counter. **Cloudflare Tunnel does
  not replace X-Forwarded-Host**, which is why origin reconstruction no longer reads it:
  it uses Host, which the tunnel sets and a page cannot forge cross-origin without
  turning the request into one that needs permission first. Set `TABUP_PUBLIC_HOST` only
  behind a proxy that rewrites Host with an internal name.
- Run one app process. Throttling is in memory and SQLite is the single writable store.
- Persist TABUP_DB and TABUP_DATA_DIR on a private volume readable only by service and
  backup accounts. They contain personal data, VAPID material and receipt images.
- Add independent edge request/body and rate limits, especially for auth and receipts.
  Each receipt is capped at 12 MiB, but repeated valid uploads still consume resources.
- Back up both SQLite and receipts, encrypt off-host copies, and test restores. A
  database-only restore does not restore receipt images.
- Keep registration closed/approval-only unless open enrollment is intentional. Trust
  only configured OIDC endpoints; use local OCR if receipts must not leave the host.
- Monitor exits, disk, backup freshness and admin errors; patch npm and the OS regularly.

## Verification evidence

Commands:

    npx next typegen
    npx tsc --noEmit
    npx eslint src scripts
    npm run build
    ./scripts/run-suites.sh
    TZ=Europe/Madrid npm run test:recurring
    npm run test:restart
    npm audit --omit=dev

Results on 2026-08-27:

- Types, ESLint, production build and diff checks: pass.
- Ten isolated-server suites: 449 passed, 0 failed.
- Non-UTC recurring suite: 17 passed, 0 failed.
- Restart persistence suite: 6 passed, 0 failed.
- Production dependencies: 0 known vulnerabilities.

The repository proves application controls, not the live proxy, TLS, firewall,
filesystem permissions, monitoring or backup schedule. Verify those deployment checks
on the host before calling an instance hardened.
