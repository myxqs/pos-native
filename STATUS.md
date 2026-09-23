# POS Native Status

## Current milestone

M4 — Structured data sources, records, typed properties, and relations
(paused during GitHub reconciliation; no M4 source changes).

M3 — Page hierarchy, archive, and navigation landed on the TypeScript/
PostgreSQL `main` line at `12dd0a6d6820d7e12f1e62f9b7644fa1f619c7d4`; live
acceptance gates remain.

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
- Canonical asset metadata foundation: generated native asset identities and
  opaque keys, bounded provenance, metadata-only creation revision/audit
  envelopes, in-memory rollback-shaped repository coverage, a PostgreSQL
  transaction adapter, and an internal service that cross-checks staged
  receipts against its owned byte snapshot before explicit expected-key
  compensation.
- ADR-0008 records TipTap/ProseMirror as a future editor-adapter direction
  while deferring package installation, complete dependency/license review, and
  production-adapter acceptance.
- Canonical page block documents: server-owned block UUIDs, parent edges,
  stable positions, soft archives, separate body revisions, recoverable
  revision snapshots, and append-oriented body audit events.
- Authenticated versioned block-document GET/PUT routes with strict input,
  CSRF-bound writes, quoted body revision compare-and-swap, explicit stale
  conflicts, and runtime PostgreSQL adapter wiring.
- A safe visible paragraph-body adapter: the browser loads and saves either an
  empty document or one root paragraph, retains a server block ID, keeps title
  and body revisions distinct, rejects unsupported richer documents without
  changing them, and ignores late selection responses.
- M3 hierarchical pages: stable nullable parent edges, bounded 32-edge
  ancestry, safe reparenting, leaf-only archive, explicit restore, separate
  metadata/body revisions, and page/revision/audit atomicity.
- M3 API and browser tree: authenticated child creation/move/archive/restore,
  explicit archived navigation, safe breadcrumbs, DOM `textContent` rendering,
  malformed-tree rejection, and generation/pending guards for late responses.
- M3 review repairs: a body write re-checks page liveness at its persistence
  boundary, returning a fixed archive conflict without adding body history;
  successful late metadata responses reconcile navigation without replacing a
  newer selection or its unsaved title/parent drafts.
- M3 persistence validates every resulting descendant—including archived
  descendants—so a direct repository/API mutation cannot create a tree the
  browser would refuse to render.
- M3 is landed at `12dd0a6d6820d7e12f1e62f9b7644fa1f619c7d4`; the clean M4
  worktree remains parked at that same checkpoint with no M4 source edits.
- Bounded public-source review recorded in `docs/architecture/DONOR_MATRIX.md`.
  No donor code, dependency, canonical store, personal data, or external MCP
  service has been introduced.

## In progress

- GitHub reconciliation is in progress: preserve the unrelated Python/SQLite
  history as legacy/reference, publish and verify the TypeScript/PostgreSQL
  candidate, replace stale Python CI requirements, and only then make the
  TypeScript line the protected default branch.
- M4 is paused pending that reconciliation and must not start automatically.
  Its eventual data-source/record/property/relation slice must preserve page
  identity, revision/audit boundaries, and the synthetic-versus-live evidence
  distinction.

## Canonical and repository boundaries

- TypeScript/PostgreSQL is the active NativePOS implementation. Its live
  PostgreSQL and end-to-end deployment acceptance remain open gates.
- Notion remains untouched and canonical until the explicit product, migration,
  integrity, retrieval, backup, and restore gates pass.
- The Python/SQLite v0.1 repository history is legacy/reference only and has no
  parallel feature-development authority.
- Open-Self and other public projects are donor/reference material only. No
  donor runtime, database, dependency, or copied code is part of NativePOS.

## Verification state

- npm run verify: PASS on 2026-09-23 — formatting, lint, strict typecheck, and
  208 tests passed across twenty-four test files; thirteen PostgreSQL
  integration tests skipped across three files because TEST_DATABASE_URL is not
  set. Asset
  and backup filesystem tests used isolated temporary roots and exercised the
  Windows symbolic-link refusal path.
- npm run db:generate: PASS on 2026-09-23 — ten tables inspected; no schema
  changes and no migration generated.
- npm run build -- --listEmittedFiles: PASS on 2026-09-23 — production
  TypeScript build completed.
- npm audit --omit=dev --json: PASS on 2026-09-23 — zero production
  vulnerabilities.
- git diff --check: PASS on 2026-09-23 — no whitespace errors after the
  independent-review repairs and documentation update.
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
- Block-document PostgreSQL migration, transaction, and restart-readback tests
  are intentionally skipped without TEST_DATABASE_URL. The browser paragraph
  adapter is synthetic-controller tested only; it is not a real-browser or
  mobile acceptance result, and it deliberately does not implement the full
  rich block-editor requirement.
- Page hierarchy PostgreSQL persistence/serialization and real-browser/mobile
  acceptance are also opt-in/live gates. The source has synthetic controller and
  in-memory proof only until `TEST_DATABASE_URL`, an owner account, and a live
  browser session are available.
- The live PostgreSQL suite is intentionally skipped until TEST_DATABASE_URL is
  supplied; this is an environment gate, not a passing integration result.
- No owner account has been created. The local interactive bootstrap command is
  implemented but must wait for a live database plus the owner's chosen email
  and password.
- The filesystem asset store, asset metadata service, and backup directory
  format are internal foundations only. A PostgreSQL metadata/audit transaction
  adapter exists but has no live proof. No upload/download API, browser
  attachment flow, live database dump/restore, or production backup rehearsal
  exists yet.
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
- ADR-0007: asset bytes are staged under a generated opaque key, then matched
  against a service-owned snapshot before one metadata/revision/audit
  repository transaction; any post-stage failure uses expected-key-only
  compensation and is not presented as atomicity.
- ADR-0008: TipTap/ProseMirror is a future UI-adapter direction only; native
  block IDs, relational rows, revisions, audit history, and APIs remain the
  canonical boundary, and no editor package is installed.
- NativePOS remains the existing TypeScript/PostgreSQL product. The new donor
  review is a selective-reference process, not a Python/SQLite rebuild or a
  merger of unrelated runtime stores.

## Exact next action

Complete the verified GitHub reconciliation: publish the candidate's truthful
documentation and TypeScript CI, prove the candidate, protect it, make it the
default, preserve/rename the Python legacy branch, and report the resulting
branch/tag/rules evidence. Stop after the reconciliation report; do not start
M4 automatically, expose asset upload, or begin Notion work. The later live
acceptance gates remain migrations, asset-metadata/block-document/hierarchy
integration, restart persistence, owner bootstrap, authenticated browser flow,
and live backup/restore after Docker is available.

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
- docs/superpowers/plans/2026-09-21-asset-metadata-service.md
- docs/superpowers/plans/2026-09-21-editor-and-block-document-core.md
- docs/superpowers/plans/2026-09-21-page-hierarchy.md
- docs/architecture/DONOR_MATRIX.md
- docs/operations/backup-restore.md
- docs/operations/assets.md
- docs/operations/development.md
- apps/api/src/
- packages/assets/
- packages/backup/
- packages/database/
- packages/domain/src/block-document.ts
