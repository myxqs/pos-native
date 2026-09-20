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

## In progress

- Browser login UX, asset storage, backup/restore, and live database/restart
  tests.

## Verification state

- npm run verify: PASS on 2026-09-20 — format, lint, strict typecheck, and
  43 tests passed across thirteen suites; two PostgreSQL integration tests skipped
  because TEST_DATABASE_URL is not set.
- npm audit --omit=dev --json: PASS on 2026-09-20 — zero production
  vulnerabilities.
- npm run db:generate: PASS on 2026-09-20 — no ungenerated schema changes.
- npm run build: PASS on 2026-09-20 — compiled API starts only from emitted
  JavaScript; compilation excludes test source and the entry point fails closed
  without runtime configuration.
- Docker client 29.8.0 and Compose 5.5.1 are present, but the Docker Desktop
  Linux-engine pipe is absent, so no database container has been started.

## Known failures / blockers

- The Docker engine is unavailable. Its pending Windows/WSL initialisation must
  be completed by a user-approved reboot; no reboot has been initiated here.
- Without a PostgreSQL runtime, migrations, transactional persistence, restart
  persistence, account/session persistence, backup, and restore are unverified.
- The browser shell is not yet an end-to-end login experience. The runtime
  composition is code-complete but cannot be presented as persistent until it
  runs against a live PostgreSQL database.
- The live PostgreSQL suite is intentionally skipped until TEST_DATABASE_URL is
  supplied; this is an environment gate, not a passing integration result.
- No owner account has been created. The local interactive bootstrap command is
  implemented but must wait for a live database plus the owner's chosen email
  and password.

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

## Exact next action

Implement browser login UX using the existing session API, then continue M1
asset and backup/restore design. After the user approves a Windows reboot and
Docker starts, run migration, live integration, restart-persistence, owner
bootstrap, and authenticated browser-flow acceptance tests.

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
