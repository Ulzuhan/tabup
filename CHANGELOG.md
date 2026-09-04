# Changelog

## 2026-09-04 — CI coverage

- Run `npm run test:enlace` in CI so the nine inter-service link checks cannot
  be skipped by an otherwise successful build. No application code or version
  change; the deployed application image remains 0.7.4.
