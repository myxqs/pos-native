# POS Native Status

## Current milestone

M1 — Sovereign canonical core and first visible vertical slice (in progress).

## Completed

- Authoritative v2 product-first brief reconciled: Notion is untouched and
  canonical. Migration, reconciliation, dual write, and cutover remain dormant
  until the explicit Usable Product Gate.
- M0 TypeScript monorepo, strict checks, deterministic lockfile, documentation,
  ADRs, threat model, PostgreSQL Compose foundation, and status handover.
- Native UUID page identity; page create/update domain commands; immutable
  revision snapshots; append-oriented audit envelopes; atomic repository port.
- Drizzle PostgreSQL schema and migrations through 0004, including page revision
  compare-and-swap state derived from any existing page history; the migration
  aborts safely rather than inventing revision history for legacy pages.
- Versioned page create/list/read/update API, with runtime validation,
  authenticated route boundary, CSRF enforcement, and explicit stale-update 409s.
- Argon2id passwords, hashed and revocable sessions, strict cookies, login rate
  limiting, server-derived human audit identity, and constant-time CSRF check.
- Restrained responsive browser shell plus separately packaged web-asset root.
  Browser writes send the double-submit CSRF proof and If-Match revision header.
- Independent M1 review findings were fixed: browser CSRF headers, stale write
  prevention, source-layout-only asset serving, legacy revision migration safety,
  and configured-asset symlink containment.
- PostgreSQL authentication adapter with parameterised queries, persisted CSRF
  token hashes, strict row mapping, and idempotent session revocation.
- Compiled, fail-closed API runtime: validated database and web-asset
  configuration, secure cookies, loopback default, and safe pool close on a
  failed listener start.
- Single-owner bootstrap is protected by a database-unique owner slot, including
  fail-closed handling of a concurrent unique-constraint conflict.
- Independent persistent-runtime review finding fixed: failed web-shell
  composition closes the already-created persistence adapter before rethrowing.
- Browser authentication UX is controller-tested: only an explicitly
  authenticated restored session, or an affirmative login response followed by
  a fresh session check, may load page data. Stale authentication responses are
  ignored; sign-out is CSRF-bound and bodyless, and browser failures use fixed
  safe text.
- Portable asset storage contract and isolated filesystem implementation:
  generated opaque native keys, validated filename/MIME metadata, bounded input
  and reads, canonical root containment, atomic no-overwrite publication,
  SHA-256 receipts, integrity verification, and regular-file-only rollback.
- Versioned `pos-native-backup` manifest and synthetic filesystem proof:
  fixed opaque database/asset paths, strict manifest validation, canonical
  checksums, source-receipt verification, manifest-last publication, bounded
  regular-file reads, no-overwrite create/restore targets, and clean-directory
  restore verification.

## In progress

- PostgreSQL asset metadata/audit integration and live database/restart tests.

## Verification state

- npm run verify: PASS on 2026-09-21 — format, lint, strict typecheck, and
  104 tests passed across eighteen suites; two PostgreSQL integration tests
  skipped because TEST_DATABASE_URL is not set. Asset and backup filesystem
  tests used isolated temporary roots and exercised the Windows symbolic-link
  refusal path.
- npm audit --omit=dev --json: PASS on 2026-09-21 — zero production
  vulnerabilities.
- npm run db:generate: PASS on 2026-09-21 — no ungenerated schema changes.
- npm run build: PASS on 2026-09-21 — compiled API and backup source start only
  from emitted JavaScript; compilation excludes test source and the entry point
  fails closed without runtime configuration.
- Docker client 29.8.0 and Compose 5.5.1 are present, but the Docker Desktop
  Linux-engine pipe is absent, so no database container has been started.
- `docker compose config` remains intentionally blocked because the untracked
  `.env` database values do not exist; no credentials were invented or written.

## Known failures / blockers

- The Docker engine is unavailable. Its pending Windows/WSL initialisation must
  be completed by a user-approved reboot; no reboot has been initiated here.
- Without a PostgreSQL runtime, migrations, transactional persistence, restart
  persistence, account/session persistence, backup, and restore are unverified.
- Browser login/session/logout flows have only synthetic controller coverage.
  They cannot be presented as a persistent end-to-end experience until an owner
  account and the runtime run against a live PostgreSQL database in a browser.
- The live PostgreSQL suite is intentionally skipped until TEST_DATABASE_URL is
  supplied; this is an environment gate, not a passing integration result.
- No owner account has been created. The local interactive bootstrap command is
  implemented but must wait for a live database plus the owner's chosen email
  and password.
- The filesystem asset store and backup directory format are internal
  foundations only. No PostgreSQL asset metadata/audit transaction,
  upload/download API, browser attachment flow, live database dump/restore,
  or production backup rehearsal exists yet.
- Filesystem behavior is verified on this Windows host. Linux execution,
  deployment ACLs, crash recovery, and startup orphan reconciliation remain
  future deployment/operations acceptance work.

## Key decisions

- ADR-0001: TypeScript npm-workspaces and contract-first domain core.
- ADR-0002: editor and persistence library selection remains a phase gate.
- PostgreSQL 18.6, Drizzle ORM/Kit, and pg remain the M1 persistence stack.
- Browser deployment resolves a configurable POS_WEB_ASSET_ROOT rather than
  assuming the TypeScript source directory structure, canonicalising the asset
  root and rejecting escapes through asset symlinks.
- API runtime uses an emitted JavaScript build rather than Node's experimental
  TypeScript execution mode; its listener defaults to loopback and secure
  cookies are always enabled.
- ADR-0005: filesystem asset bytes use opaque native-ID keys below a
  canonicalised configured root; filenames are metadata only, and rollback-only
  discard does not create a user deletion API.
- ADR-0006: backups use versioned manifests and fixed directory artifacts with
  source-port separation, checksums, no-overwrite restore, and a synthetic
  clean filesystem proof before a live PostgreSQL adapter is attempted.

## Exact next action

Design and implement the next coherent M1 asset-metadata service/repository
slice, coupling staged filesystem receipts to the existing `assets` table,
provenance, audit, and rollback semantics without claiming a live transaction
until PostgreSQL is available. After the user approves a Windows reboot and
Docker starts, run migration, live integration, restart-persistence, owner
bootstrap, authenticated browser-flow, and live backup/restore acceptance tests.

## Commands to resume

    npm run verify
    npm audit --omit=dev --json
    docker version
    docker compose config

## Important paths

- docs/specs/pos-native-v1.md
- docs/superpowers/plans/2026-09-20-m1-shell-safety-hardening.md
- docs/superpowers/plans/2026-09-20-browser-login-experience.md
- docs/superpowers/plans/2026-09-20-asset-storage-foundation.md
- docs/superpowers/plans/2026-09-21-backup-restore-proof.md
- docs/operations/backup-restore.md
- docs/operations/development.md
- apps/api/src/
- packages/assets/
- packages/backup/
- packages/database/
