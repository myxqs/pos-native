# NativePOS M5 Machine Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Every behavior change follows RED-GREEN-REFACTOR.

**Goal:** Deliver a bounded, auditable machine-facing discovery, retrieval, traversal, context, and mutation layer over accepted M4 structured data.

**Architecture:** Add focused domain/database machine contracts on top of existing page-backed records, typed values, relations, revisions, and audit. Expose them through authenticated `/api/v1/machine/*` routes; retain existing CSRF and server-derived actor boundaries for mutation. Use one additive migration only for query-support indexes or metadata proven necessary.

**Tech Stack:** TypeScript, Fastify, Zod, PostgreSQL 18, Drizzle, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-m5-machine-interface-design.md`

## Global constraints

- Base is accepted M4 commit `26feaa1a4c37f4b18edd7e9fdc437b5e92f747b2`.
- Notion remains canonical; no real data, dual writes, provider adapters, KERNEL, Local Steward, deployment, cutover, or UI redesign.
- Queries require a selector, limit at 100, deterministic ordering, opaque cursor, and no raw SQL surface.
- Traversal depth is at most 3 and nodes at most 100, with cycle suppression.
- Context budgets explicitly report truncation/omission and continuation hints.
- Every mutation requires an expected revision and produces transactional revision/audit evidence.
- Bulk mutation is explicit-ID only, maximum 100 records, dry-run capable, fully prevalidated, and atomic.

## Review focus

- Empty filters cannot dump all records.
- Similar titles do not collapse stable identities.
- Stale revision prevents every scalar, relation, title, archive, and bulk write.
- Graph cycles and high-degree nodes remain within depth/node budgets.
- Bulk validation failure writes nothing and audit cannot be bypassed.

### Task 1: Machine contracts and schema discovery

**Files:** Create `packages/domain/src/machine.ts`, tests; export through domain index.

- [ ] RED tests for deterministic entity/property discovery, supported capabilities, options, relation targets, invalid property kinds, and stable error codes.
- [ ] Implement immutable machine contract types, cursor codec, bounds, and discovery projection from M4 sources/definitions.
- [ ] Run focused and full default tests; commit.

### Task 2: Structured query and PostgreSQL projection

**Files:** Create machine repository port/in-memory implementation, PostgreSQL implementation/tests; modify schema and add migration only if required.

- [ ] RED tests for ID/title/property/status/date/number/relation/archive filters, sorting, cursor pagination, malformed/unbounded rejection, and bounded scale.
- [ ] Implement validated query AST and deterministic compact results without generic SQL.
- [ ] RED live tests, implement PostgreSQL query, generate/inspect additive migration, prove M4 upgrade and fresh application.
- [ ] Commit repository/migration slice.

### Task 3: Relationships, history, and bounded context

**Files:** Extend machine repository/service and tests.

- [ ] RED tests for incoming/outgoing neighbours, typed traversal, cycle suppression, depth/node bounds, deterministic order, and continuation/truncation.
- [ ] RED tests for context profiles/budgets containing identity, selected properties, bounded content, relationships, provenance, and recent history with omission metadata.
- [ ] Implement traversal/history/context composition over existing canonical records, edges, page blocks, revisions, and audit.
- [ ] Run focused/default/live tests; commit.

### Task 4: Atomic and bounded bulk mutations

**Files:** Extend domain commands/repositories/services/tests.

- [ ] RED tests for set, clear, title, archive/restore, add/remove relation, preservation of unrelated values, invalid target/type, and stale revision conflict.
- [ ] Implement narrow typed operations through existing revision/audit transactions.
- [ ] RED tests for explicit-ID bulk preview, count/limit, full prevalidation, atomic commit/rollback, audit evidence, and stale-item rejection.
- [ ] Implement capped bulk scalar set/clear; do not add query-selected or arbitrary batches.
- [ ] Run focused/default/live tests; commit.

### Task 5: Authenticated machine HTTP surface

**Files:** Create machine service/routes/tests; wire app/runtime.

- [ ] RED route tests for discovery, get/query, relationships, traversal, context, history, atomic/bulk mutation, auth, CSRF, validation, cursor, stable errors, and conflict responses.
- [ ] Implement `/api/v1/machine/*` as a thin adapter over domain/repository services.
- [ ] Add system capabilities endpoint and contract inventory; no standalone MCP server.
- [ ] Run route/runtime/live tests; commit.

### Task 6: Synthetic benchmark, recovery, docs, and checkpoint

**Files:** Create synthetic fixture/benchmark suite and concise M5 architecture/operations docs; update status/changelog/recovery acceptance.

- [ ] Build deterministic synthetic people/organisations/projects/events/areas/actions/evidence fixtures and 50-100 correctness cases.
- [ ] Prove result/context/graph bounds as fixture volume grows; record exact case count.
- [ ] Run default, benchmark, live PostgreSQL, M4-upgrade, fresh migration, recovery, drift, build, format, lint, typecheck, production audit, diff, secret/path, and artifact gates.
- [ ] Perform whole-branch review and one test-first fix pass for Critical/Important findings.
- [ ] Commit, push `codex/m5-machine-interface`, verify clean synchronized checkpoint, and stop.
