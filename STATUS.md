# POS Native Status

## Current milestone

M1 — Sovereign canonical core (in progress).

## Completed

- Verified M0/M1 foundation committed on `main` as `c9e610a`.
- Authoritative v2 product-first prompt located in Google Drive as file
  `16G3GN1fLvRg8d5n4BizdDj7ECp_saWMR`, fully read and reconciled on 2026-09-16.
- M0 monorepo/tooling foundation: exact dependency lockfile, strict TypeScript,
  ESLint, Prettier, Vitest and the unified `npm run verify` command.
- Monorepo foundation, canonical native-ID contract, validated `createPage`
  command, revision envelope and audit-event envelope implemented.
- Architecture foundation, threat model, ADR framework, initial plan, source
  manifest, Docker compose foundation and operational documentation created.
- Argon2id password service, Fastify health/version API endpoints, M1 Drizzle
  schema and two generated PostgreSQL migrations created.
- Idempotency replay/conflict domain service created and tested.
- Page update commands now preserve stable identity and emit sequential
  revisions plus before/after audit events.
- Transactional page repository contract implemented with atomic rollback
  tests; the PostgreSQL adapter writes page/revision/audit state in one
  transaction.
- Versioned create/list/read/update page API and a restrained responsive browser
  shell are implemented behind an injected repository/actor boundary.
- Local login/session service stores only SHA-256 token hashes, enforces expiry
  and revocation, and validates CSRF tokens with constant-time hash comparison.
- Fastify authentication routes set strict cookies, rate-limit login, derive the
  audit actor from the server-side session, and fail page routes closed.

## In progress

- PostgreSQL account/session persistence, production runtime composition,
  browser login UX, asset storage, backup/restore and live database tests.

## Verification state

- `npm run verify`: PASS — format, lint, strict typecheck and 25 tests across
  ten passing suites (fresh run 2026-09-16).
- PostgreSQL page repository contract: present but one live integration test is
  SKIPPED because `TEST_DATABASE_URL` is unavailable.
- `npm audit --omit=dev --json`: PASS — 0 vulnerabilities.
- `git diff --check`: no whitespace errors in the verified foundation.
- Docker Desktop 4.91.0, Docker CLI 29.8.0, and Compose 5.5.1 were installed
  from the verified official Winget package on 2026-09-17. WSL 2 platform
  enablement is pending a required Windows reboot before engine verification.

## Known failures / blockers

- Docker engine remains unavailable until the pending WSL/Windows reboot is
  completed and Docker Desktop has initialised.
- PostgreSQL CLI/server is unavailable on this host, so live migration,
  transaction, restart-persistence, and restore verification are blocked until
  an approved PostgreSQL/Docker environment is available.
- M0/M1 external package installation is pending the specifically scoped
  approval required by the operating charter. Resolved: the approved Node
  package set is installed and pinned in `package-lock.json`.
- `npm audit` reports four moderate development-only advisory paths through
  `drizzle-kit`'s older esbuild loader. The installed `drizzle-kit@0.31.10` is
  current; npm proposes an unsafe anomalous downgrade, so no forced fix was run.

## Key decisions

- ADR-0001: TypeScript npm-workspaces monorepo and contract-first domain core.
- ADR-0002: defer editor and persistence library finalisation to phase gates.
- Proposed M1 persistence stack: PostgreSQL 18.6, Drizzle ORM/Kit and `pg`.
- ADR-0004: M0 toolchain and audit mitigation.

## Exact next action

Provide an approved live PostgreSQL environment (Docker or native PostgreSQL),
then implement and verify persistent account/session runtime composition and
the restart-persistence acceptance path. Frontend/editor package installation
also requires explicit approval before M2.

## Commands to resume

```powershell
npm test
git status --short --branch
docker compose config
```

## Important paths

- `docs/specs/pos-native-v1.md`
- `docs/plans/2026-09-14-m0-m1.md`
- `docs/architecture/`
- `packages/domain/`
