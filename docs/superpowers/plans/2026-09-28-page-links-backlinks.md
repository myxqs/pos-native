# Page Links and Backlinks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit, recoverable page links with derived bounded backlinks from domain through browser.

**Architecture:** A dedicated canonical link entity follows existing revision/audit conventions. PostgreSQL stores only forward links; repository joins derive forward/backlink navigation while filtering archived endpoints.

**Tech Stack:** TypeScript, PostgreSQL 18.6, Drizzle, Fastify, Zod, Vitest, browser JavaScript.

**Spec:** `docs/superpowers/specs/2026-09-28-page-links-backlinks-design.md`

## Global Constraints

- Do not reuse collection relation edges or parse paragraph text.
- Reject self, unknown, archived-endpoint, and duplicate active links.
- Archive rather than delete; relinking creates a new stable identity.
- Bound lists to 1-100 and validate repository output before API exposure.
- Use PowerShell locally and push only to `origin`.

## Review Focus

- Concurrent duplicate creation must yield one active relationship.
- Active navigation must suppress either archived endpoint without erasing history.
- Latest revision snapshots must match current link rows.
- API output validation must reject malformed canonical state.
- Browser generations must suppress responses from prior selections.

### Task 1: Domain and in-memory repository

- [x] Write failing domain/repository tests for create, rejection, archive, history, ordering, relink, and rollback.
- [x] Implement `PageLink` mutations and repository contract.
- [x] Run focused and default tests.

### Task 2: PostgreSQL and migration 0011

- [x] Write failing live tests for endpoints, uniqueness, queries, archive/relink, history, rollback, corruption, concurrency, and restart.
- [x] Add schema, indexes, migration, and transactional repository.
- [x] Apply migration and run focused live tests.

### Task 3: Authenticated API

- [x] Write failing tests for auth, CSRF, validation, endpoint state, lists, unlink, limits, and malformed output.
- [x] Implement routes and runtime composition.
- [x] Run focused and default tests.

### Task 4: Workspace links surface

- [x] Write failing browser tests for rendering, search/create/unlink/navigation, empty/error, XSS, and stale responses.
- [x] Implement minimal selected-page forward/backlink panels and search target picker.
- [x] Run focused and default tests.

### Task 5: Acceptance and checkpoint

- [x] Update architecture, operations, recovery acceptance, and status documentation.
- [x] Run full default/live PostgreSQL/build/migration/audit/scanning gates.
- [x] Complete independent review and resolve Critical/Important findings.
- [x] Pre-flight, commit, push, verify, and reassess the Navigation roadmap.
