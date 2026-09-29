# Changelog

## Unreleased

### Added

- M5 authenticated machine interface with deterministic schema discovery,
  bounded typed queries, cycle-safe relation traversal, budgeted context,
  redacted audit history, and a 64-case synthetic retrieval/mutation benchmark.

- Authenticated bounded asset upload/list/download backed by canonical
  PostgreSQL metadata and verified local filesystem bytes.
- Safe full-state PostgreSQL plus asset backup/restore with clean-target guards,
  staged-file compensation, receipt cross-integrity, and post-restore evidence.
- Disposable PostgreSQL 18 named-volume acceptance proving source and restored
  application/database restart persistence and exact asset-byte recovery.

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
- Canonical asset-metadata domain/service foundation with native identities,
  bounded provenance, metadata-only revision/audit records, transactional
  repository adapters, staged receipt checksum/size cross-checking, and
  explicit expected-key filesystem compensation.
- Canonical block-document rows, separate page-body revisions, soft archives,
  revision snapshots, append-oriented audit records, and atomic repository
  adapters.
- Authenticated page-body GET/PUT API routes with CSRF-bound writes and quoted
  body revision compare-and-swap.
- Safe visible single-paragraph page-body editor that fails closed for richer
  documents, preserves native block identity, and guards against stale browser
  responses.
- Native hierarchical pages with stable parent edges, child creation,
  reparenting, leaf-only archive, explicit restore, active/archived navigation,
  and bounded breadcrumbs.
- Browser hierarchy controls that preserve independent title/body revisions,
  reject malformed trees, use safe DOM text rendering, and protect newer
  selections and drafts from late requests.
- A bounded public donor matrix that records reference-only source evaluation
  and conditions for future selective adaptation.

### Changed

- Full-state PostgreSQL backup now brackets `pg_dump` with matching asset
  receipt projections and refuses publication if concurrent asset state changes.

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
- ADR-0008 now records TipTap/ProseMirror as an uninstalled future adapter
  direction while requiring a later exact dependency/license/security review.
- Repository hierarchy validation now checks every resulting descendant, so a
  move cannot place a live or archived subtree node beyond the 32-edge limit.
- Block-document persistence now refuses an in-flight write if its page became
  archived after route validation, preserving a fixed 409 response and empty
  body history for the rejected write.
- Successful page metadata mutations now reconcile active/archived navigation
  after a newer selection, while keeping that newer editor and its title/parent
  draft intact.
