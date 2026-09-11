# Changelog

## 2026-09-11 — Minor and patch dependencies, by hand

- Sixteen packages move to the versions Renovate had been proposing since 30-08:
  `@base-ui/react` 1.6.0 → 1.8.0, `lucide-react` 1.28.0 → 1.45.0, `shadcn`
  4.16.1 → 4.21.0, `tailwindcss` and `@tailwindcss/postcss` 4.3.0 → 4.3.3,
  `react` and `react-dom` 19.2.4 → 19.3.0, `better-sqlite3` 13.0.2 → 13.0.3,
  `eslint` 9.39.4 → 9.39.5, `sonner` 2.0.7 → 2.0.8, `tsx` 4.23.5 → 4.23.13,
  `postcss` 8.5.25 → 8.5.28, `nanoid` 3.3.18 → 3.3.19 and the `@types/*`.
- Done by hand because that pull request could not be merged: it changed
  `package.json` and left the lockfile behind, so `npm ci` failed on it every
  time — before and after a rebase.
- No application code changed. The whole battery passes: route types, types,
  lint, build, the eleven suites (488 assertions), back-channel logout,
  delegated identity, verified e-mail linking and recurring dates outside UTC.
  The interface was also looked at, since this moves the component library, the
  icons and Tailwind: both public pages render with their styles, their icons
  and no console errors.

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
