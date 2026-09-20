# M1 Persistent Authentication and Runtime Implementation Plan

> For agentic workers: use the test-driven-development and executing-plans
> workflows task by task.

**Goal:** Replace test-only authentication persistence in the production
composition, provide a fail-closed local server runtime, and provide a safe
operator-owned path to initialise the one local account.

**Architecture:** PostgreSQL stores only the password hash and hashes of random
session and CSRF tokens. A narrow parameterised-query adapter implements the
existing AuthenticationStore contract; page writes retain the existing Drizzle
transactional repository. Runtime configuration is validated before any server
is composed, binds loopback by default, and always uses secure cookies. Owner
initialisation is an explicit interactive local command that never accepts a
password in a command argument or logs it.

**Tech Stack:** Node.js 24, TypeScript 6, Fastify 5, PostgreSQL 18, pg,
Drizzle ORM, Argon2id, Zod 4, Vitest 5.

**Spec:** docs/specs/pos-native-v1.md

## Global Constraints

- Notion remains untouched and canonical. Tests use synthetic data only.
- No password, session token, CSRF token, DATABASE_URL, or account secret is
  written to logs, audit events, fixtures, or documentation examples.
- Existing sessions are safely revoked by a schema transition that cannot invent
  an unknown CSRF secret.
- Runtime is fail-closed when the database URL or packaged asset root is absent.
- The default listener is loopback; wider network binding is explicit operator
  configuration and does not expose the application publicly by itself.
- No live PostgreSQL success claim is valid until Docker and TEST_DATABASE_URL
  are available and the opt-in suite runs.

## Task 1: Persisted authentication contract and safe schema transition

**Files:**

- Modify: packages/database/src/schema.ts
- Create: packages/database/src/postgres-authentication-store.ts
- Create: packages/database/test/postgres-authentication-store.test.ts
- Modify: packages/database/test/schema.test.ts
- Generate: packages/database/drizzle/0003 migration and metadata

- [x] Write failing recording-client tests for account lookup, hashed-session
      inserts, session lookup, and revocation. The tests must prove parameterised
      values and must not contain raw session or CSRF values in persisted records.
- [x] Add csrf_token_hash to sessions. Generate a migration that revokes any
      pre-existing session before making that column non-null, rather than creating
      a guessed CSRF token.
- [x] Implement the PostgreSQL AuthenticationStore with parameterised queries,
      strict row validation, timestamp normalisation, and idempotent revocation.
- [x] Run focused tests, npm run db:generate, and strict type checking.

## Task 2: Fail-closed production runtime

**Files:**

- Create: apps/api/src/runtime.ts
- Create: apps/api/src/server.ts
- Create: apps/api/test/runtime.test.ts
- Modify: package.json

- [x] Write failing tests for missing runtime configuration, loopback defaults,
      secure-cookie composition, and authenticated page writes through a supplied
      persistence adapter.
- [x] Parse and validate DATABASE_URL, POS_WEB_ASSET_ROOT, POS_LISTEN_HOST, and
      POS_PORT without echoing their values. Support only loopback by default and
      explicit 0.0.0.0 or :: binding for private-network deployment.
- [x] Compose Pool, Drizzle page repository, PostgreSQL authentication store,
      AuthenticationService, and buildApp in one production-only factory. Ensure a
      failed listener start closes its pool. Add a node start:api entry point.
- [x] Run focused tests and full verification.

## Task 3: Explicit one-owner bootstrap path

**Files:**

- Create: packages/database/src/local-account-bootstrap.ts
- Create: packages/database/test/local-account-bootstrap.test.ts
- Create: scripts/bootstrap-owner.mjs
- Modify: .env.example
- Modify: docs/operations/development.md

- [x] Write failing tests for a single lower-cased owner insert, no password in
      SQL text, and fail-closed duplicate-owner behaviour.
- [x] Implement a narrow parameterised bootstrap adapter. The interactive script
      requires a valid --email argument, reads and confirms a hidden terminal
      password, hashes it with Argon2id, and closes the pool in all outcomes.
- [x] Document the local-only, one-time operator procedure without embedding a
      password in shell history, environment examples, or source control.
- [x] Run focused tests and full verification.

## Task 4: Evidence, review, and checkpoint

- [x] Run npm run verify, npm audit --omit=dev --json, npm run db:generate, and
      git diff --check.
- [x] Record exact test counts and still-blocked live migration, persistence,
      restart, browser-flow, backup, and restore gates in STATUS.md and CHANGELOG.md.
- [x] Request an independent review; repair P1/P2 findings test-first.
- [x] Commit a focused M1 checkpoint after the lifecycle repair follow-up review found no P1/P2 issues.

## Review repair

- [x] Persistence is closed when a packaged web-root validation failure prevents
      Fastify application composition; the regression is covered by a unit test.

## Self-review

This plan does not start Docker, add an account, connect Notion, or assert that
the product is ready for migration. The account bootstrap command is an
operator tool; executing it requires a chosen local email and secret from the
owner. The next acceptance work after this plan requires a user-approved host
reboot so PostgreSQL can be verified live.
