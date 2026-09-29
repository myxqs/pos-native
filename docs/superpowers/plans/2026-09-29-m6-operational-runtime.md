# NativePOS M6 Operational Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a private, durable Docker Compose runtime with service-token authentication, readiness, Windows-local operations, and proven full-state recovery.

**Architecture:** A production multi-stage image and private Compose network run the compiled Fastify API beside PostgreSQL with named database and asset volumes. Existing domain/repository boundaries remain authoritative; a bearer-token authorizer, schema readiness probe, and PowerShell operator add the operational layer without changing canonical data design.

**Tech Stack:** TypeScript, Fastify, PostgreSQL 18.6, Drizzle, Docker Compose, PowerShell, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-m6-operational-runtime-design.md`

## Global Constraints

- Loopback host publication only; PostgreSQL has no host port in production-local Compose.
- No MCP, ChatGPT, public exposure, firewall, Cloudflare, Notion, KERNEL, migration/cutover, Task Scheduler installation, or reboot actions.
- Real credentials remain ignored and never appear in output, errors, audit payloads, or logs.
- Production-local and acceptance Compose project names/volumes remain separate.
- Every behavior change follows RED-GREEN TDD; operational files receive structural and live acceptance tests.

## Review Focus

- Missing/short bearer token must fail configuration or authorization without echoing it (Task 1 tests).
- Human cookie/CSRF behavior must remain unchanged when bearer auth is added (Task 1 regression tests).
- Database reachable but migration-incompatible must stay not-ready and prevent startup (Task 2 tests).
- Docker delayed at logon must end after bounded retries with an actionable failure (Task 4 tests).
- Backup must contain PostgreSQL plus canonical asset bytes, while restore must refuse the production target (Task 4/5 tests).

---

### Task 1: Machine service authentication

**Files:**

- Create: `apps/api/src/service-token.ts`
- Modify: `apps/api/src/runtime.ts`, `apps/api/src/auth-routes.ts`
- Test: `apps/api/test/service-token.test.ts`, `apps/api/test/runtime.test.ts`, `apps/api/test/auth-routes.test.ts`

**Interfaces:**

- Produces: `ServiceTokenAuthenticator.authenticate(header): ServiceActor | null`; runtime `POS_SERVICE_TOKEN`; combined session/bearer `PageAuthorizer`.
- Consumes: existing `PageAuthorizer`, audit actor and route validation boundaries.

- [ ] Write tests for missing/invalid/valid bearer tokens, safe comparison, API-token actor attribution, browser CSRF preservation, and fail-closed token configuration.
- [ ] Run focused tests and observe expected failures because service-token support does not exist.
- [ ] Implement the minimal authenticator and composed authorizer; never return or log token material.
- [ ] Run focused tests and full default suite; commit `feat(auth): add local service token boundary`.

### Task 2: Readiness, status, shutdown and diagnostics

**Files:**

- Create: `apps/api/src/readiness.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/runtime.ts`, `apps/api/src/server.ts`
- Test: `apps/api/test/readiness.test.ts`, `apps/api/test/app.test.ts`, `apps/api/test/runtime.test.ts`

**Interfaces:**

- Produces: `RuntimeReadiness.check(): Promise<ReadinessResult>`; `/health`, `/ready`, authenticated `/api/v1/system/status`; idempotent signal shutdown.
- Consumes: Task 1 authorizer and the runtime PostgreSQL pool.

- [ ] Write tests for live/ready distinction, database failure, migration mismatch, safe status fields, startup refusal and idempotent SIGINT/SIGTERM cleanup.
- [ ] Run focused tests and observe expected failures.
- [ ] Implement the probe using bounded PostgreSQL queries against the expected migration state; wire safe structured logger redaction and graceful shutdown.
- [ ] Run focused tests and full default suite; commit `feat(runtime): add readiness and graceful diagnostics`.

### Task 3: Production-local Docker Compose runtime

**Files:**

- Create: `Dockerfile`, `.dockerignore`, `compose.production.yaml`, `.env.production.example`
- Modify: `package.json`
- Test: `apps/api/test/production-compose.test.ts`

**Interfaces:**

- Produces: production image, `nativepos-app`, private PostgreSQL service, named `postgres-data` and `asset-data` volumes, explicit migration command, loopback-only app publication.
- Consumes: Tasks 1-2 runtime configuration and readiness endpoints.

- [ ] Write structural tests for loopback publication, absent PostgreSQL ports, restart policies, health checks, log rotation, named volumes, placeholder-only environment and no automatic destructive migration.
- [ ] Run tests and observe expected missing-file failures.
- [ ] Add the minimal multi-stage image, Compose profile and scripts.
- [ ] Build image, validate Compose config, run structural tests and default suite; commit `feat(ops): add production-local compose runtime`.

### Task 4: PowerShell operator and prepared auto-start

**Files:**

- Create: `scripts/nativepos.ps1`, `scripts/nativepos-task.ps1`
- Test: `apps/api/test/operations-scripts.test.ts`

**Interfaces:**

- Produces: safe `Build|Migrate|Start|Stop|Restart|Status|Logs|Backup|Restore` operator actions and non-installed Task Scheduler XML/registration preparation with bounded Docker readiness retry.
- Consumes: Task 3 Compose names, existing `postgres-recovery.mjs`, ignored environment and backup paths.

- [ ] Write structural/process tests for fixed Compose project, bounded Docker retry, no elevation/firewall/public binding, deliberate restore inputs, production-target refusal, verified full-state backup and asset-volume handling.
- [ ] Run tests and observe expected missing-script failures.
- [ ] Implement scripts with strict parameter validation; Task Scheduler default action only prepares/prints definition and registration requires an explicit future switch not invoked by acceptance.
- [ ] Run focused tests and default suite; commit `feat(ops): add Windows operator and autostart preparation`.

### Task 5: Live persistence, recovery, documentation and checkpoint

**Files:**

- Create: `apps/api/test/production-local-runtime.integration.test.ts`
- Modify: `docs/operations/deployment.md`, `docs/operations/backup-restore.md`, `docs/operations/development.md`, `README.md`, `STATUS.md`, `CHANGELOG.md`

**Interfaces:**

- Produces: isolated acceptance proving app/PostgreSQL/full-stack restart, bearer authentication, durable database/assets, backup/restore, restored query/readiness, and manual reboot procedure.
- Consumes: all earlier tasks plus existing 64-case M5 benchmark and 17-table recovery harness.

- [ ] Write the opt-in integration acceptance and observe it fail against the incomplete runtime/operator surface.
- [ ] Complete only the wiring needed for the acceptance, then run isolated production-like Compose persistence and full-state restore.
- [ ] Document exact setup/operator/token-rotation/recovery/manual-reboot procedures and limitations.
- [ ] Run the complete M6 validation matrix, security/artifact scans and whole-branch self-review; fix only Critical/Important findings test-first.
- [ ] Perform final Git pre-flight, commit `docs: close M6 operational runtime`, push `codex/m6-operational-runtime`, and stop.
