# Authenticated Page and Paragraph Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver deterministic authenticated Navigation search from active canonical page and paragraph data through PostgreSQL, API, and the existing browser workspace.

**Architecture:** A read-only `SearchRepository` owns shared validation and an in-memory behavioral reference. The PostgreSQL implementation queries canonical live rows directly using bounded full-text and indexed trigram candidates; the authenticated API and plain-DOM browser consume a minimal typed result contract.

**Tech Stack:** TypeScript 6, PostgreSQL 18.6, Drizzle SQL, Fastify 5, Zod 4, Vitest 5, browser JavaScript.

**Spec:** `docs/superpowers/specs/2026-09-28-authenticated-page-paragraph-search-design.md`

## Global Constraints

- Search is derived and rebuildable; canonical PostgreSQL rows remain authoritative.
- Search only active page titles and active paragraph text.
- Query length is 2-100 Unicode code points; result limit is 1-50 and defaults to 20.
- Return one best result per page with a plain-text snippet of at most 240 code points.
- Do not add external services, embeddings, rich-editor work, or a mutation path.
- Use PowerShell for all local commands and contact only `origin` for Git pushes.

## Review Focus

- Unicode length boundaries must count code points rather than UTF-16 units.
- Archived live-block remnants must still be excluded when their page is archived.
- A stale browser response must not replace results for a newer query or logged-out state.
- Title and paragraph candidates on the same page must collapse to the deterministic best match.
- Trigram fallback must remain index-constrained and capped before final ordering.

---

### Task 1: Search repository contract and reference behavior

**Files:**

- Create: `packages/database/src/search-repository.ts`
- Test: `packages/database/test/search-repository.test.ts`

**Interfaces:**

- Produces: `SearchQuery`, `SearchResult`, `SearchRepository.search(query)`, `InMemorySearchRepository`, and shared query/result normalization.

- [x] Write failing behavioral tests for title/body matching, rank tiers, per-page collapse, stable ordering, limits, malformed input, archive exclusion, updates, restore, and empty results.
- [x] Run `npm test -- packages/database/test/search-repository.test.ts` and verify the missing contract fails.
- [x] Implement the minimal validated in-memory reference behavior.
- [x] Rerun the focused test and the default suite.

### Task 2: PostgreSQL indexed search

**Files:**

- Modify: `packages/database/src/schema.ts`
- Create: `packages/database/src/postgres-search-repository.ts`
- Create: `packages/database/test/postgres-search-repository.integration.test.ts`
- Create: `packages/database/drizzle/0010_*.sql`
- Modify: `packages/database/drizzle/meta/_journal.json`
- Create: `packages/database/drizzle/meta/0010_snapshot.json`

**Interfaces:**

- Consumes: `SearchRepository` contract from Task 1 and canonical `pages`/`blocks` tables.
- Produces: `PostgresSearchRepository.search(query)` with the same result semantics.

- [x] Write failing live tests for migration/extension setup, title/body search, deterministic ranking, boundaries, mutation visibility, archive/restore behavior, restart persistence, and `EXPLAIN` evidence of a relevant index.
- [x] Run the focused live test against disposable PostgreSQL 18.6 and verify failure for missing implementation/migration.
- [x] Add partial GIN full-text/trigram indexes and the bounded SQL candidate query.
- [x] Generate migration 0010, inspect it, migrate the disposable database, and rerun focused live tests.

### Task 3: Authenticated search API and runtime wiring

**Files:**

- Create: `apps/api/src/search-routes.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/runtime.ts`
- Create: `apps/api/test/search-routes.test.ts`
- Modify: `apps/api/test/runtime.test.ts`

**Interfaces:**

- Consumes: `SearchRepository.search({ query, limit })` and existing `PageAuthorizer`.
- Produces: authenticated `GET /api/v1/search?q=...&limit=...` response `{ results: SearchResult[] }`.

- [x] Write failing tests for authentication, strict validation, default/hard limits, response shape, no leakage, and generic repository failure.
- [x] Run focused API/runtime tests and verify they fail because the route/wiring is absent.
- [x] Implement the route and optional app/runtime composition.
- [x] Rerun focused tests and the default suite.

### Task 4: Minimal workspace search surface

**Files:**

- Modify: `apps/web/index.html`
- Modify: `apps/web/app.js`
- Modify: `apps/web/app.d.ts`
- Modify: `apps/web/styles.css`
- Modify: `apps/api/test/web-shell.test.ts`

**Interfaces:**

- Consumes: `GET /api/v1/search` and the existing page-selection flow.
- Produces: sidebar search input, bounded result list, empty/error states, and result-to-page navigation.

- [x] Write failing browser-controller tests for rendering, empty/error states, safe text, stale responses, bounded payload rejection, and selecting a result.
- [x] Run the focused web-shell test and verify the absent UI behavior fails.
- [x] Implement the smallest DOM surface using `textContent` and the existing selection function.
- [x] Rerun focused tests and the default suite.

### Task 5: Documentation, full validation, review, and checkpoint

**Files:**

- Modify: `docs/architecture/pos-native-foundation.md`
- Modify: `docs/operations/development.md`
- Modify: `STATUS.md`

**Interfaces:**

- Consumes: completed Tasks 1-4.
- Produces: documented ranking, extension/rebuild operations, acceptance evidence, and a focused pushed checkpoint.

- [x] Document the canonical/derived boundary, ranking, limits, `pg_trgm`, rebuild path, and exact acceptance evidence.
- [x] Run format, lint, strict typecheck, default tests, full disposable PostgreSQL suite, build, migration generation/drift, `git diff --check`, production audit, secret/private-path scan, and generated-artifact scan.
- [x] Request independent read-only review against the spec and plan; resolve all Critical and Important findings test-first.
- [x] Perform the complete pre-flight, commit conventionally, push only to `origin`, and re-inspect the local Navigation roadmap.
