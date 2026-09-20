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
- Drizzle PostgreSQL schema and migrations through 0002, including page revision
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

## In progress

- PostgreSQL-backed account/session store, production server composition, browser
  login UX, asset storage, backup/restore, and live database/restart tests.

## Verification state

- npm run verify: PASS on 2026-09-20 — format, lint, strict typecheck, and
  31 tests passed across ten suites; two PostgreSQL integration tests skipped
  because TEST_DATABASE_URL is not set.
- npm audit --omit=dev --json: PASS on 2026-09-20 — zero production
  vulnerabilities.
- npm run db:generate: PASS on 2026-09-20 — no ungenerated schema changes.
- Docker client 29.8.0 and Compose 5.5.1 are present, but the Docker Desktop
  Linux-engine pipe is absent, so no database container has been started.

## Known failures / blockers

- The Docker engine is unavailable. Its pending Windows/WSL initialisation must
  be completed by a user-approved reboot; no reboot has been initiated here.
- Without a PostgreSQL runtime, migrations, transactional persistence, restart
  persistence, account/session persistence, backup, and restore are unverified.
- The browser shell is not yet an end-to-end login experience and no production
  runtime composition exists. It must not be presented as a usable persistent POS.
- The live PostgreSQL suite is intentionally skipped until TEST_DATABASE_URL is
  supplied; this is an environment gate, not a passing integration result.

## Key decisions

- ADR-0001: TypeScript npm-workspaces and contract-first domain core.
- ADR-0002: editor and persistence library selection remains a phase gate.
- PostgreSQL 18.6, Drizzle ORM/Kit, and pg remain the M1 persistence stack.
- Browser deployment resolves a configurable POS_WEB_ASSET_ROOT rather than
  assuming the TypeScript source directory structure, canonicalising the asset
  root and rejecting escapes through asset symlinks.

## Exact next action

Implement the persistent PostgreSQL account/session store and a fail-closed
server composition using unit-contract tests. After the user approves a Windows
reboot and Docker starts, run migration, live integration, restart-persistence,
and authenticated browser-flow acceptance tests.

## Commands to resume

    npm run verify
    npm audit --omit=dev --json
    docker version
    docker compose config

## Important paths

- docs/specs/pos-native-v1.md
- docs/superpowers/plans/2026-09-20-m1-shell-safety-hardening.md
- docs/operations/development.md
- apps/api/src/
- packages/database/
