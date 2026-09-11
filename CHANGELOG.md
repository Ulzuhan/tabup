# Changelog

## 2026-09-11 — Next 16.3.5: two unauthenticated RCEs

- **next 16.2.12 → 16.3.5.** Closes two critical advisories: unauthenticated
  remote code execution in the Image Optimization API when AVIF files are
  handled, and an equivalent one on Windows-hosted servers — that second one
  does not reach this image, but it travels in the same version. Both fixed
  upstream in 16.3.3.
- Alongside it: **sharp 0.35.3 → 0.35.4** (libheif), fast-uri 3.1.5 → 3.1.7,
  js-yaml 4.3.1 → 4.3.2, hono 4.12.34 → 4.13.7 and qs 6.15.3 → 6.16.0.
  `npm audit` goes from thirteen open advisories to none.
- `eslint-config-next` follows the Next version. No application code changed:
  route types, types, lint and build are clean, and the whole battery passes —
  eleven suites, back-channel logout, delegated identity, verified e-mail
  linking and recurring dates outside UTC.

This is a dependency release. Nothing in the data, the configuration or the
access model changes.

## 2026-09-04 — CI coverage

- Run `npm run test:enlace` in CI so the nine inter-service link checks cannot
  be skipped by an otherwise successful build. No application code or version
  change; the deployed application image remains 0.7.4.
