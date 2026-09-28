# Bounded Context Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authenticated, derived, depth-1 page context endpoint with deterministic bounds and provenance.

**Architecture:** Compose `PageRepository.getById`, `PageLinkRepository.listForward`, and `listBacklinks` in one API module. Validate all repository output, trim `limit + 1` reads, deduplicate and sort nodes, and persist nothing.

**Tech Stack:** TypeScript, Fastify, Zod, Vitest, PostgreSQL 18.6.

**Spec:** `docs/superpowers/specs/2026-09-28-bounded-context-bundle-design.md`

## Global Constraints

- Fixed depth 1; limit 1–20 per direction; at most 40 edges and 41 nodes.
- Active state only; no history mode, recursion, graph storage, cache, or UI.
- Authentication required; GET needs no CSRF proof.
- No migration or dependency change.

## Review Focus

- A neighbour in both directions is deduplicated without losing either edge.
- `limit + 1` detects truncation without exposing the extra edge.
- Repository corruption produces a fixed failure, not a partial bundle.
- Ordering is explicit and independent of input/Map insertion order.
- Archived root and malformed query responses do not leak repository details.

### Task 1: Context composition and API

**Files:**

- Create: `apps/api/src/page-context-routes.ts`
- Create: `apps/api/test/page-context-routes.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**

- Consumes: existing `PageRepository`, `PageLinkRepository`, and `PageAuthorizer`.
- Produces: authenticated `GET /api/v1/pages/:pageId/context?limit=20`.

- [x] Write failing route tests for authentication, roots, directions, sorting, deduplication, limits, truncation, and malformed/corrupt results.
- [x] Run the focused tests and verify the route is absent.
- [x] Implement the bounded route and runtime validation.
- [x] Run focused tests and the default suite.

### Task 2: Evidence and checkpoint

**Files:**

- Modify: `docs/architecture/pos-native-foundation.md`
- Modify: `docs/operations/development.md`
- Modify: `STATUS.md`

**Interfaces:**

- Consumes: Task 1 endpoint behavior.
- Produces: truthful architecture, operational limits, and continuation state.

- [x] Document derived-state, bounds, recovery, and failure behavior.
- [x] Run the full default/live PostgreSQL/build/drift/audit/scanning gates.
- [x] Complete independent review and resolve Critical/Important findings.
- [x] Pre-flight, commit, push, and reassess the local Navigation roadmap.
