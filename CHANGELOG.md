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
- Safe migration failure for any legacy page without revision history.
- PostgreSQL-backed local account/session persistence with hashed CSRF tokens.
- Safe migration transition that revokes legacy sessions before requiring their
  CSRF token hash.
- Fail-closed compiled API runtime, including safe listener-start cleanup.
- Interactive one-owner bootstrap command that never accepts a plaintext
  password by argument or environment variable.
- Canonical web-asset root validation that rejects escaping asset symlinks.
- Database-enforced single-owner slot with fail-closed concurrent-bootstrap
  protection.
- Browser login, restored-session gating, and CSRF-bound sign-out controls.
- Portable asset-storage contracts with opaque native-ID storage keys, validated
  filename/MIME metadata, configurable byte limits, and SHA-256 receipts.
- Filesystem-backed asset staging with canonical-root containment, atomic
  no-overwrite publication, bounded reads, integrity verification, symlink
  refusal, and idempotent regular-file rollback.
- Versioned `pos-native-backup` manifests with canonical checksums, fixed
  database/asset artifact paths, source-receipt validation, and synthetic
  filesystem create/list/verify/clean-restore proof.

### Changed

- Browser page mutation requests now send CSRF and If-Match proof headers.
- Runtime composition now closes persistence when web-asset validation fails.
- Stale page writes return 409 rather than overwriting current state.
- Lint excludes managed linked worktrees, preserving reproducible root checks.
- Browser requests explicitly use same-origin credentials and render generic
  authentication and availability errors.
- Login now fails closed unless it receives an explicit authenticated response
  and a fresh authenticated session check; stale authentication responses
  cannot reopen the workspace, and bodyless logout does not send a JSON content
  type.
- Filesystem asset reads now bind validation and bounded reads to one file
  handle, staging owns a byte snapshot before asynchronous work, and successful
  fallback cleanup no longer reports a false failure after publication.
