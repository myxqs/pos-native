# M7 Hardening and Migration-Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the M6 runtime fail closed on migration-ledger drift, make recovery operations safer, and provide exact synthetic migration-rehearsal evidence.

**Architecture:** Preserve the current runtime and recovery boundaries. Tighten readiness at the existing PostgreSQL probe, harden the existing PowerShell operator, and document the human-gated rehearsal workflow.

**Tech Stack:** TypeScript 6, Fastify, PostgreSQL 18.6, Drizzle, Vitest, PowerShell, Docker Compose

**Spec:** `docs/superpowers/specs/2026-10-07-m7-hardening-readiness-design.md`

## Global Constraints

- Do not migrate personal data or contact Notion.
- Do not expose NativePOS publicly or add integrations.
- Do not disturb Docker/PostgreSQL resources not proven exclusive to NativePOS.
- Preserve M0-M6 history and behavior; no push or merge.

## Review Focus

- Same-count but altered migration ledger must fail readiness.
- Missing, duplicated, reordered, or extra migration rows must fail readiness.
- Invalid backup must fail before recovery-target creation.
- Retention overflow must preserve backups without explicit prune confirmation.
- Runbook must not imply that synthetic acceptance authorizes real cutover.

---

### Task 1: Exact migration-ledger readiness

**Files:**

- Modify: `apps/api/src/readiness.ts`
- Modify: `apps/api/src/runtime.ts`
- Test: `apps/api/test/readiness.test.ts`

**Interfaces:**

- Consumes: ordered `created_at` values from `drizzle.__drizzle_migrations`
- Produces: the existing `RuntimeReadiness.check()` result contract

- [ ] Add failing tests for exact match and same-count drift.
- [ ] Run the focused test and confirm the drift case fails.
- [ ] Compare the ordered ledger with the twelve journal timestamps.
- [ ] Run focused and runtime tests; commit.

### Task 2: Recovery operator preflight and explicit pruning

**Files:**

- Modify: `scripts/nativepos.ps1`
- Test: `apps/api/test/operations-scripts.test.ts`

**Interfaces:**

- Consumes: existing recovery `verify` command and backup retention setting
- Produces: `-ConfirmPruneBackups` and verify-before-target behavior

- [ ] Add failing source-contract tests for preflight ordering and opt-in prune.
- [ ] Run the focused test and confirm failure.
- [ ] Add backup verification before target mutation and gate removal on the switch.
- [ ] Run focused tests and PowerShell parser validation; commit.

### Task 3: Migration-rehearsal runbook and milestone evidence

**Files:**

- Create: `docs/operations/migration-readiness.md`
- Modify: `STATUS.md`
- Modify: `docs/architecture/migration.md`

**Interfaces:**

- Produces: human-review gates and exact preflight/rehearsal/rollback/post-check steps

- [ ] Document supported synthetic scope, unsupported/deferred scope, backup requirement, dry run, rollback, verification, and human gates.
- [ ] Record accurate M7 status without authorizing cutover.
- [ ] Run documentation checks and commit.

### Task 4: Full safe validation and review

- [ ] Run format check, lint, typecheck, build, default tests, M5 benchmark, audit, schema drift check, and secret/private-path scan.
- [ ] Inspect shared Docker state read-only; run NativePOS live gates only if isolated execution is safe.
- [ ] Review the complete diff and working-tree state; repair any finding test-first and commit.
