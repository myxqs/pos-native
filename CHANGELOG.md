# Changelog

## Unreleased

### Added

- POS Native repository, architecture, ADR and operational-documentation base.
- Test-first native page creation with revision and audit envelopes.
- M0 Docker/PostgreSQL development configuration and resumable status record.
- Product-first v2 specification reconciliation and explicit migration gates.
- Atomic page create/update repository contract with PostgreSQL adapter.
- Versioned page API and responsive create/select/rename browser shell.
- Fail-closed local login, hashed server-side sessions, strict cookies, CSRF
  validation, login rate limiting, and authenticated audit attribution.
- Page revision compare-and-swap migration and explicit conflict handling.
- Configurable and validated browser web-asset root.

### Changed

- Browser page mutation requests now send CSRF and If-Match proof headers.
- Stale page writes return 409 rather than overwriting current state.
- Lint excludes managed linked worktrees, preserving reproducible root checks.
