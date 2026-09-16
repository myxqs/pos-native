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

## In progress

- Transactional PostgreSQL repositories, account/session/token persistence,
  CSRF/session lifecycle, asset storage, backup/restore and live database tests.

## Verification state

- `npm run verify`: PASS — format, lint, strict typecheck and 12 tests across
  five suites (fresh baseline run 2026-09-16).
- `npm audit --omit=dev --json`: PASS — 0 vulnerabilities.
- `git diff --check`: no whitespace errors in the verified foundation.
- Docker development stack: unverified because Docker is not installed on this
  host; no installation has been performed.

## Known failures / blockers

- Docker CLI is unavailable.
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

Implement the transactional page repository boundary test-first, including
atomic page/revision/audit persistence and read/update contracts. Run all
non-live tests now; retain live PostgreSQL tests as an explicit environment gate.

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
