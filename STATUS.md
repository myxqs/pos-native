# POS Native Status

## Current milestone

M5 - COMPLETE for the provider-disconnected, synthetic machine-first boundary.
Schema discovery, typed bounded retrieval, graph traversal, compact context,
redacted history, and the existing optimistic/audited atomic mutation routes
form a coherent agent-facing HTTP surface. Bulk mutation and a thin MCP adapter
are explicitly deferred; no Notion data was imported and Notion remains
canonical.

M4 — COMPLETE for the repository-local synthetic structured-data and
Navigation boundary. Structured data sources, records, typed properties,
relations, assets and recoverable relationships now have domain, in-memory,
PostgreSQL persistence, authenticated API, and minimal browser product flows.
Safe full-state PostgreSQL plus asset recovery is implemented. Persistent
named-volume restart and clean full-state recovery acceptance now pass with
synthetic state; direct browser file-chooser automation remains externally
blocked without broader Chrome extension permission.

Navigation search now has a complete first vertical slice: active page titles
and paragraphs are queried directly from canonical PostgreSQL state through
bounded full-text/trigram indexes, an authenticated API, and a minimal safe
workspace search surface. The bounded depth-one context contract and page-link
provenance presentation are also complete.

First-class page links and derived backlinks now span domain, transactional
PostgreSQL persistence, authenticated API, and the selected-page workspace.
Unlink is recoverable archive, relinking preserves old history with a new UUID,
and normal navigation suppresses archived endpoints.

## Completed

- Authoritative v2 product-first brief reconciled: Notion is untouched and
  canonical. Migration, reconciliation, dual write, and cutover remain dormant
  until the explicit Usable Product Gate.
- M0 TypeScript monorepo, strict checks, deterministic lockfile, documentation,
  ADRs, threat model, PostgreSQL Compose foundation, and status handover.
- Native UUID page identity; page create/update domain commands; immutable
  revision snapshots; append-oriented audit envelopes; atomic repository port.
- Drizzle PostgreSQL schema and migrations through 0007, including page revision
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
- Disposable PostgreSQL recovery rehearsal: a custom-format dump was restored
  into a fresh database with `--exit-on-error`, wrapped in the versioned backup
  manifest, checksum-verified, and read back for pages, block content,
  hierarchy, hashed session state, asset metadata, structured definitions,
  records, typed values, relation edges, revisions, and audit events. The built
  loopback application then accepted the preserved synthetic session and read
  the restored workspace. A later PostgreSQL container restart retained the
  same counts, and a second application process again accepted that session.
- Packaged local PostgreSQL recovery operator: shell-free bounded Docker
  commands create and manifest-verify custom dumps, reject duplicate backup
  destinations, verify artifacts offline, refuse non-empty database targets
  before mutation, and restore only with `pg_restore --exit-on-error
--single-transaction`. Live
  historical acceptance compared counts and deterministic row hashes for the
  then-current fifteen canonical tables and exercised both refusal paths without
  changing accepted state. A later current-schema rehearsal compares all
  seventeen tables.
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
- Hierarchical pages: stable nullable parent edges, bounded 32-edge
  ancestry, safe reparenting, leaf-only archive, explicit restore, separate
  metadata/body revisions, and page/revision/audit atomicity.
- Hierarchy API and browser tree: authenticated child creation/move/archive/restore,
  explicit archived navigation, safe breadcrumbs, DOM `textContent` rendering,
  malformed-tree rejection, and generation/pending guards for late responses.
- Hierarchy review repairs: a body write re-checks page liveness at its persistence
  boundary, returning a fixed archive conflict without adding body history;
  successful late metadata responses reconcile navigation without replacing a
  newer selection or its unsaved title/parent drafts.
- Hierarchy persistence validates every resulting descendant—including archived
  descendants—so a direct repository/API mutation cannot create a tree the
  browser would refuse to render.
- Structured data foundations: source-scoped definitions with canonical Unicode
  name keys, typed scalar values, page-backed records, soft-archived relation
  edges, optimistic property revisions, revision/audit history, database shape
  constraints, and stable concurrent duplicate-name conflicts.
- GitHub reconciliation completed: the TypeScript/PostgreSQL candidate and
  truthful TypeScript CI are the retained active line; unrelated Python/SQLite
  history remains legacy/reference only.
- Bounded public-source review recorded in `docs/architecture/DONOR_MATRIX.md`.
  No donor code, dependency, canonical store, personal data, or external MCP
  service has been introduced.

## In progress

- M4 product behaviour is accepted for synthetic authenticated asset upload,
  retrieval, restart persistence, and full-state recovery. Human-operated
  browser file-chooser/download acceptance, Linux deployment, malware/content
  policy, and personal-data migration remain outside this boundary.
- Bounded page-to-asset linkage and recoverable unlink are implemented with stable link UUIDs,
  provenance, revision/audit evidence, transactional PostgreSQL persistence,
  authenticated list/attach/unlink routes, and a selected-page browser surface.
  Unlink soft-archives relationship evidence and permits a later new link;
  asset deletion, covers, previews, and editor embeds remain deferred.
- Task 9 independent review is complete for all 16 OCR-selected implementation
  files in `358b854..dec2634`. One confirmed backup snapshot-consistency finding
  was repaired test-first by bracketing `pg_dump` with matching PostgreSQL asset
  receipt projections.
- Authenticated page/paragraph search is implemented with deterministic ranking,
  active-only semantics, mutation/restart visibility, migration 0010, bounded
  plain-text results, and stale-response-safe browser navigation.
- Page links/backlinks are implemented as a separate canonical relationship
  model with migration 0011, active-pair uniqueness, revision/audit evidence,
  bounded derived backlinks, target search, navigation, and recoverable unlink.
  Creation is serialised with page archive through the shared hierarchy advisory
  transaction lock and rechecks both endpoints after acquiring it.
- A read-only authenticated context contract derives deterministic depth-one
  forward/backlink bundles with explicit provenance, per-direction truncation,
  node deduplication, fixed limits, and fail-closed repository validation. It
  adds no canonical graph state or migration.
- Current-schema recovery acceptance now covers all seventeen table counts and
  deterministic hashes plus active forward/backlink results, archived link
  history, distinct relink identity, page-link revisions/audits, restored
  authenticated paragraph search, and PostgreSQL restart readback.
- Page-link provenance presentation uses the existing bounded authenticated
  routes and links panel to show canonical link IDs, creation timestamps,
  source/actor evidence, and clearly labelled active/archived forward history.
  It adds no canonical state, endpoint, or migration.
- The formal M4 criterion classification is recorded in
  `docs/architecture/m4-closure.md`; no blocking M4 gaps remain.

## Canonical and repository boundaries

- TypeScript/PostgreSQL is the active NativePOS implementation. Its isolated
  live PostgreSQL integration suite and a synthetic authenticated browser
  recovery rehearsal pass; production deployment acceptance remains open.
- Notion remains untouched and canonical until the explicit product, migration,
  integrity, retrieval, backup, and restore gates pass.
- The Python/SQLite v0.1 repository history is legacy/reference only and has no
  parallel feature-development authority.
- Open-Self and other public projects are donor/reference material only. No
  donor runtime, database, dependency, or copied code is part of NativePOS.

## Verification state

- npm run verify: PASS on 2026-09-28 — formatting, lint, strict typecheck, and
  372 tests passed; 29 opt-in integration tests were skipped because the standard
  command does not set TEST_DATABASE_URL.
- Live PostgreSQL suite: PASS on 2026-09-28 — all 400 tests passed across 49
  files with a disposable `TEST_DATABASE_URL` and `--no-file-parallelism`,
  including search ranking/index use, archive/restore mutation visibility,
  page-asset unlink, page links/backlinks, history, relink, corrupt-revision
  rejection, deterministic page-link/archive races, and restart persistence.
- The remaining live-suite skip is the separately gated destructive recovery
  acceptance. It requires source/target URLs plus a named disposable container
  and passes separately, including clean restore and container restart.
- npm run db:generate and npm run db:migrate: PASS on 2026-09-28 — seventeen
  tables inspected, no schema drift found, and migrations applied successfully
  to the disposable restored database.
- npm run build: PASS on 2026-09-28 — production TypeScript build completed.
- npm audit --omit=dev --json: PASS on 2026-09-28 — zero production
  vulnerabilities.
- git diff --check: PASS on 2026-09-28 — no whitespace errors in the acceptance
  documentation checkpoint.
- Docker client/server 29.8.0 and the Docker Desktop Linux/WSL2 engine are
  healthy. The PostgreSQL 18.6 acceptance containers and named volumes were
  disposable; their test-only connection values were process-local and were
  not written to the repository, and the resources were removed after use.

## Known failures / blockers

- The packaged recovery operator is deliberately local and Docker-scoped; it is
  not an encrypted, scheduled, or production credential-management service.
- A synthetic hashed session survived the dump/restore and application restart
  and was accepted in a real browser. Production session/token lifecycle policy
  for backups remains undecided; no personal owner credentials were used.
- The browser paragraph adapter is synthetic-controller tested only; it is not
  a real-browser or mobile acceptance result, and it deliberately does not
  implement the full rich block-editor requirement.
- Page hierarchy PostgreSQL persistence/serialization and restored real-browser
  readback are live-tested with synthetic state; mobile acceptance remains open.
- Page links/backlinks and the derived depth-one context contract are covered by
  unit, API, browser-controller, and live
  PostgreSQL acceptance; real-browser interaction remains unclaimed.
- No personal owner account has been created. Synthetic owner bootstrap is
  accepted only in disposable PostgreSQL environments.
- Browser file-chooser automation is blocked because the ChatGPT Chrome
  extension lacks file-URL access. Security permissions were not broadened.
  Authenticated API byte equality and browser-visible listing pass. Browser
  download-event capture also times out without a UI or console error, so direct
  browser upload/download automation remains explicitly unclaimed.
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

Stop product development at the clean M4 checkpoint. Perform a human-operated
synthetic workspace review next; retain the browser file-chooser/download gap
without broadening Chrome permissions. Do not begin another milestone or
Notion work without a fresh explicit continuation.

## Commands to resume

    npm run verify
    npm audit --omit=dev --json
    # After `docker info` succeeds, create an untracked .env from .env.example.
    # Use only a fresh disposable database: POSTGRES_DB=pos_native_test.
    docker compose -p pos-native-live-test up -d postgres
    $env:TEST_DATABASE_URL = "postgresql://pos_native:<local-password>@localhost:5432/pos_native_test"
    npm test -- packages/database/test/postgres-page-repository.integration.test.ts packages/database/test/postgres-block-document-repository.integration.test.ts packages/database/test/postgres-asset-metadata-repository.integration.test.ts --no-file-parallelism

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
