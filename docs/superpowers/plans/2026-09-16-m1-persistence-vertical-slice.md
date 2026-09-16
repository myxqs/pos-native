# M1 Persistence Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist page creation and updates atomically with their revision and audit records, expose the boundary through the versioned API, and prepare the first browser-visible flow without pretending live PostgreSQL has been verified.

**Architecture:** Keep domain commands pure and inject one transactional persistence port. A Drizzle/PostgreSQL adapter owns database transactions; Fastify routes validate external input and invoke the application service. Tests first prove the application contract with a transaction-aware in-memory adapter, then live integration tests prove the same contract when `TEST_DATABASE_URL` is available.

**Tech Stack:** Node.js 24, TypeScript 6, Fastify 5, Drizzle ORM, PostgreSQL 18, Zod 4, Vitest 5.

**Spec:** `docs/specs/pos-native-v1.md`

## Global Constraints

- Notion remains untouched and canonical; only synthetic test data is allowed.
- Every canonical entity uses a native UUID.
- Each page mutation atomically persists the page, revision, and audit event.
- External input is runtime validated; no route writes directly to tables.
- Live PostgreSQL claims require `TEST_DATABASE_URL` and a fresh passing run.
- No migration work begins before the explicit Usable Product Gate approval.

---

### Task 1: Page update domain command

**Files:**

- Modify: `packages/domain/src/page.ts`
- Test: `packages/domain/test/page.test.ts`

**Interfaces:**

- Consumes: `Page`, `UpdatePageCommand`, `CreatePageDependencies`.
- Produces: `updatePage(page, revisionNumber, command, dependencies): UpdatePageMutation`.

- [ ] Write a failing test proving title update preserves identity, increments revision, timestamps the page, and emits `page.updated` with before/after snapshots.
- [ ] Run `npm test -- packages/domain/test/page.test.ts` and confirm failure because `updatePage` is missing.
- [ ] Implement validation and the minimal immutable mutation result.
- [ ] Run the focused test and all domain tests.

### Task 2: Transactional persistence port and in-memory contract adapter

**Files:**

- Create: `packages/database/src/page-repository.ts`
- Create: `packages/database/test/page-repository.test.ts`

**Interfaces:**

- Consumes: `CreatePageMutation`, `UpdatePageMutation`, native page ID.
- Produces: `PageRepository` with `create`, `update`, `getById`, and `list`; mutation methods return persisted pages and must be atomic.

- [ ] Write failing contract tests for create/read/list/update and rollback when revision or audit persistence fails.
- [ ] Run the focused test and confirm failure because the repository contract is missing.
- [ ] Implement the port plus a deterministic in-memory adapter used only for contract/application tests.
- [ ] Run focused and full tests.

### Task 3: PostgreSQL adapter and opt-in live contract suite

**Files:**

- Create: `packages/database/src/postgres-page-repository.ts`
- Create: `packages/database/test/postgres-page-repository.integration.test.ts`
- Modify: `packages/database/src/schema.ts`

**Interfaces:**

- Consumes: a Drizzle `NodePgDatabase` and the `PageRepository` contract.
- Produces: atomic PostgreSQL persistence using one transaction per mutation.

- [ ] Add an opt-in integration suite that applies migrations to an isolated database and runs the repository contract.
- [ ] Confirm the suite reports a clear skip when `TEST_DATABASE_URL` is absent, without claiming live verification.
- [ ] Implement the adapter with explicit transaction boundaries and affected-row checks.
- [ ] Run non-live verification; run live verification only when the environment exists.

### Task 4: Versioned page API

**Files:**

- Create: `apps/api/src/page-routes.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/page-routes.test.ts`

**Interfaces:**

- Consumes: injected `PageRepository`, Zod-validated request bodies, actor context.
- Produces: `POST /api/v1/pages`, `GET /api/v1/pages`, `GET /api/v1/pages/:id`, and `PATCH /api/v1/pages/:id`.

- [ ] Write failing API tests for create/list/read/update plus malformed input and missing page responses.
- [ ] Confirm expected route-not-found failures.
- [ ] Implement routes through domain commands and the repository port.
- [ ] Run focused API tests and full verification.

### Task 5: Browser-visible shell without new dependencies

**Files:**

- Create: `apps/web/index.html`
- Create: `apps/web/app.js`
- Create: `apps/web/styles.css`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/web-shell.test.ts`

**Interfaces:**

- Consumes: the versioned page API.
- Produces: a restrained responsive page list/editor shell served by Fastify.

- [ ] Write a failing server test for the shell and a DOM-independent smoke test for its API calls.
- [ ] Implement the minimal create/select/rename flow with accessible HTML and responsive CSS.
- [ ] Run the focused tests and full verification.
- [ ] Record that React/editor-library selection remains a later approved dependency gate; this shell proves the vertical slice rather than replacing the M2 editor.

### Task 6: Checkpoint and evidence

**Files:**

- Modify: `STATUS.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/operations/development.md`

- [ ] Run `npm run verify`, `npm audit --omit=dev`, and `git diff --check`.
- [ ] If a live database is available, run migrations and the PostgreSQL integration suite; otherwise record the exact unverified gate.
- [ ] Update status with observed counts, limitations, and the next exact task.
- [ ] Commit only the coherent verified slice.

## Self-review

The plan covers the next M1 vertical slice only. It preserves the product-first staging contract, makes no live-database claim without evidence, and leaves M2 editor/library selection and all migration work outside this checkpoint.
