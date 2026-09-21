# Asset Metadata Service and Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist safely staged NativePOS asset metadata with creation revision
and audit history, while compensating a failed canonical write without exposing
an upload endpoint or claiming a live PostgreSQL transaction.

**Architecture:** Move opaque asset-key and metadata validation into the domain
contract so the filesystem adapter depends on canonical rules rather than the
reverse. Add a metadata-only asset mutation and repository port, then orchestrate
the existing `AssetStore` and repository through an internal service. The
PostgreSQL adapter writes `assets`, `revisions`, and `audit_events` in one
transaction; the service explicitly compensates filesystem state if that
transaction cannot commit.

**Tech Stack:** TypeScript 6 strict mode, existing Drizzle/PostgreSQL schema,
Node standard-library filesystem store, Vitest 5, no new dependency.

**Spec:**
`docs/superpowers/specs/2026-09-21-asset-metadata-service-design.md`

## Global Constraints

- Do not install a dependency, run Docker, create credentials, invoke a shell
  utility from application code, or change the current PostgreSQL schema.
- Keep Notion untouched and canonical. Do not add import, dual-write,
  migration/cutover, cloud storage, public upload/download, browser attachment,
  page-cover, MCP, or deletion behaviour.
- All asset IDs and storage keys must be generated native UUID-v4 values;
  filenames and external identifiers never choose paths or canonical identity.
- Metadata/revision/audit snapshots must contain no asset bytes, database URL,
  password, session/API token, or arbitrary provenance blob.
- Persist `assets`, revision `1`, and audit in one repository transaction.
  Filesystem cleanup is explicit compensation, not claimed atomicity.
- If a stage succeeded and later validation, verification, or persistence fails,
  call `discard` only for the generated expected opaque key. Surface both
  failures if compensation fails.
- Preserve the portable `AssetStore` contract and re-export its public key and
  metadata helpers from `packages/assets` for existing callers.
- Keep PostgreSQL integration tests opt-in under `TEST_DATABASE_URL`; no skipped
  test is evidence of live acceptance.
- Use TDD: every production behavior begins with a focused test observed RED,
  then minimal GREEN implementation, then relevant suite evidence.

## Review Focus

- A store receipt with another asset ID/key/metadata or a failed verification
  must never reach canonical persistence; Task 3 owns receipt-validation and
  cleanup tests.
- A repository failure after metadata insertion must leave no metadata,
  revision, or audit history; Task 2 owns injected rollback and live forced
  revision-conflict tests.
- A compensation failure must retain both original and cleanup failures under a
  typed orphan condition, with only the opaque generated key; Task 3 owns it.
- Unsafe filename/MIME/checksum/size/provenance/request/run inputs and raw-byte
  leakage in snapshots must fail closed; Task 1 owns them.
- Duplicate native IDs or storage keys must never replace an existing record;
  Task 2 owns in-memory uniqueness and opt-in PostgreSQL constraints.

---

### Task 1: Domain-owned asset metadata and audit/revision contract

**Files:**

- Create: `packages/domain/src/asset.ts`
- Create: `packages/domain/test/asset.test.ts`
- Modify: `packages/domain/src/audit.ts`
- Modify: `packages/domain/src/page.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/assets/src/asset-storage.ts`
- Modify: `packages/database/src/postgres-page-repository.ts`

**Interfaces:**

- Consumes: `NativeId`, `asNativeId`, `ValidationError`, current page audit
  envelopes, and current public asset storage helpers.
- Produces: `AssetStorageKey`, `asAssetStorageKey`, `storageKeyForAsset`,
  `normaliseAssetMetadata`, `Asset`, `PreparedAssetCreation`,
  `AssetStageReceipt`, `CreateAssetMutation`, `prepareAssetCreation`, and
  `createAssetMutation` for Tasks 2–3; typed `Revision`/`AuditEvent` support
  for both `page` and `asset` records.

- [x] **Step 1: Write the failing domain tests**

  Create `packages/domain/test/asset.test.ts` with fixed UUID-v4 values and
  `2026-09-21T12:00:00.000Z`. Import the missing domain asset functions. Pin
  that a prepared creation normalises `" Report.pdf "` and `" Application/PDF
"`, creates an opaque `asset-<id>` key, and completing it with a matching
  receipt creates revision `1` / `entityType: "asset"` and audit action
  `asset.created`. Give the command a request UUID, run ID, and reason; assert
  audit context and string provenance retain only those values.

  Add parameterized invalid filenames (`""`, `"../report"`, `"dir\\report"`,
  control character), malformed MIME, unsafe/negative size, uppercase/short
  checksum, a receipt for a different asset ID, and a receipt key that does not
  equal `storageKeyForAsset(id)`. Each must throw `ValidationError`. Serialize
  `mutation.revision.snapshot` and `mutation.audit.after`; assert neither has a
  `bytes` property and neither serialized form contains fixture byte text.

- [x] **Step 2: Run the domain test to verify RED**

  Run:

  ```bash
  npm test -- packages/domain/test/asset.test.ts
  ```

  Expected: FAIL because `packages/domain/src/asset.ts` does not exist.

- [x] **Step 3: Implement the minimal domain contract and compatible re-export**

  In `audit.ts`, introduce `NativeEntityType = "page" | "asset"` and
  `AuditAction = "page.created" | "page.updated" | "asset.created"`.
  Parameterise `Revision<TSnapshot, TEntityType>` and
  `AuditEvent<TSnapshot, TTargetType, TAction>` with safe defaults, and add
  optional `requestId`, `idempotencyKey`, `reason`, and `metadata` fields. Keep
  page mutation types precise (`"page"` plus their correct action) and update
  `PostgresPageRepository` to map optional fields to existing audit columns.

  In `asset.ts`, define the key brand and exact `asset-<uuid>` parser, existing
  filename/MIME normalisation rules, safe size and SHA-256 validation, bounded
  `AssetCreationContext`, immutable `Asset`, a pre-stage prepared creation, and
  a completion function. `createAssetMutation` must require an exact matching
  stage receipt and create metadata-only revision/audit snapshots. Use
  conditional object spreads for optional audit fields so strict optional
  property typing stays accurate.

  Update `asset-storage.ts` to import and re-export the domain key/metadata
  functions/types while retaining `AssetStore`, `AssetStoreReceipt`,
  `AssetStageInput`, and `StagedAsset` as the storage-port compatibility layer.
  No storage behavior changes in this task.

- [x] **Step 4: Run domain, asset-storage, lint, and strict type checks**

  Run:

  ```bash
  npm test -- packages/domain/test/asset.test.ts packages/domain/test/page.test.ts packages/assets/test/asset-storage.test.ts
  npm run lint
  npm run typecheck
  ```

  Expected: new asset tests and existing page/storage tests pass; lint and
  strict TypeScript remain clean.

- [x] **Step 5: Commit the domain boundary**

  ```bash
  git add packages/domain/src/asset.ts packages/domain/src/audit.ts packages/domain/src/page.ts packages/domain/src/index.ts packages/domain/test/asset.test.ts packages/assets/src/asset-storage.ts packages/database/src/postgres-page-repository.ts
  git commit -m "feat: add asset metadata domain contract"
  ```

### Task 2: Atomic asset metadata repositories

**Files:**

- Create: `packages/database/src/asset-metadata-repository.ts`
- Create: `packages/database/src/postgres-asset-metadata-repository.ts`
- Create: `packages/database/test/asset-metadata-repository.test.ts`
- Create: `packages/database/test/postgres-asset-metadata-repository.integration.test.ts`

**Interfaces:**

- Consumes: Task 1 `CreateAssetMutation`, `Asset`, typed revision/audit
  envelopes, and existing Drizzle `assets`, `revisions`, and `auditEvents`
  tables.
- Produces: `AssetMetadataRepository`, `PersistedAssetMetadata`,
  `InMemoryAssetMetadataRepository`, and `PostgresAssetMetadataRepository` for
  Task 3 and future runtime wiring.

- [x] **Step 1: Write failing in-memory and opt-in PostgreSQL tests**

  Add a deterministic `assetCreation()` helper using `prepareAssetCreation` /
  `createAssetMutation`. The in-memory test must prove `create` exposes the
  asset at revision `1`, `list` is stable, and `revisionsFor` / `auditFor`
  contain one matching metadata-only envelope. Add injected
  `before-revision` and `before-audit` failures; both must leave `getById`,
  `list`, revision history, and audit history empty. Repeating a native ID
  must reject without replacing the original.

  The conditionally skipped PostgreSQL test must migrate, truncate
  `audit_events, revisions, assets CASCADE`, persist one asset, and read it
  back. Force a second mutation to reuse an existing revision ID after a new
  asset row would be inserted; assert transaction rollback means the second
  asset has no row, revision, or audit event. Keep all test values synthetic;
  no filesystem store or credentials are used.

- [x] **Step 2: Run repository tests to verify RED**

  Run:

  ```bash
  npm test -- packages/database/test/asset-metadata-repository.test.ts packages/database/test/postgres-asset-metadata-repository.integration.test.ts
  ```

  Expected: FAIL because the metadata repository modules do not exist; the
  opt-in integration suite remains skipped after imports resolve without
  `TEST_DATABASE_URL`.

- [x] **Step 3: Implement repository ports and one SQL transaction**

  Define:

  ```ts
  interface PersistedAssetMetadata {
    readonly asset: Asset;
    readonly revisionNumber: number;
  }

  interface AssetMetadataRepository {
    create(mutation: CreateAssetMutation): Promise<Asset>;
    getById(id: NativeId): Promise<PersistedAssetMetadata | null>;
    list(): Promise<readonly Asset[]>;
  }
  ```

  The in-memory implementation stores assets, opaque storage-key uniqueness,
  revision history, and audit history together. Snapshot all affected state and
  restore it on either injected failure. `revisionsFor` / `auditFor` remain
  test inspection methods rather than public production query APIs.

  The PostgreSQL implementation inserts the asset row, revision, and audit
  event inside one `database.transaction`. Map optional audit fields to the
  existing columns and preserve string provenance. `getById` validates stored
  key, metadata, provenance, and an asset revision before returning it; `list`
  is deterministically ordered by creation time/native ID. Do not add a schema
  migration or invent a current-revision column for immutable creation.

- [x] **Step 4: Run repository tests, lint, and strict type checks**

  Run:

  ```bash
  npm test -- packages/database/test/asset-metadata-repository.test.ts packages/database/test/postgres-asset-metadata-repository.integration.test.ts packages/database/test/page-repository.test.ts
  npm run lint
  npm run typecheck
  ```

  Expected: synthetic repository tests pass; PostgreSQL cases are explicitly
  skipped without a test URL; page repository tests remain green.

- [x] **Step 5: Commit the repository boundary**

  ```bash
  git add packages/database/src/asset-metadata-repository.ts packages/database/src/postgres-asset-metadata-repository.ts packages/database/test/asset-metadata-repository.test.ts packages/database/test/postgres-asset-metadata-repository.integration.test.ts
  git commit -m "feat: add asset metadata repositories"
  ```

### Task 3: Compensating internal asset service

**Files:**

- Create: `packages/assets/src/asset-service.ts`
- Create: `packages/assets/test/asset-service.test.ts`

**Interfaces:**

- Consumes: Task 1 domain creation functions, `AssetStore`, and Task 2
  `AssetMetadataRepository`.
- Produces: `AssetService`, `CreateStoredAssetInput`,
  `AssetServiceDependencies`, `AssetStorageIntegrityError`, and
  `AssetCompensationError` for future authenticated adapters.

- [x] **Step 1: Write failing service tests using recording fakes**

  Create an in-test recording `AssetStore` that returns a deterministic staged
  receipt and delegates canonical persistence to the real in-memory repository.
  Assert successful `AssetService.create` copies bytes before the async stage,
  calls `verify`, persists the matching metadata/revision/audit, and never
  calls discard. Assert a repository `before-audit` failure calls discard once
  for the generated expected key and leaves no repository state.

  Add separate tests for a stage throw (no repository call and no discard), a
  `verify` result of `false` (no repository write plus discard), a malformed
  returned receipt for another valid asset key (no repository write; discard
  only the expected generated key), and a discard failure after repository
  failure. The last must throw `AssetCompensationError` with both causes and
  the opaque expected key, never fixture bytes or filename in the message.

- [x] **Step 2: Run the service test to verify RED**

  Run:

  ```bash
  npm test -- packages/assets/test/asset-service.test.ts
  ```

  Expected: FAIL because `asset-service.ts` does not exist.

- [x] **Step 3: Implement the minimal orchestration and compensation path**

  Define a service constructor receiving `assetStore`, `assetRepository`, and
  injected `newId`/`now`. `create` must reject a non-`Uint8Array`, copy the
  bytes before its first `await`, prepare the domain creation, stage using its
  generated ID/normalised metadata, complete the domain mutation, verify the
  staged receipt, and call repository create. Return the canonical mutation
  asset only after repository success.

  Track only whether `stage` fulfilled. From then on, catch validation,
  verification, or repository errors and attempt `discard` for
  `storageKeyForAsset(prepared.id)`. Never delete a key returned by a malformed
  receipt. If cleanup fails, throw an `AggregateError`-derived
  `AssetCompensationError` with the original operation error as cause and an
  opaque expected key for reconciliation. Do not add idempotency replay,
  logging, HTTP, or deletion behaviour.

- [x] **Step 4: Run focused service/repository tests and full suite**

  Run:

  ```bash
  npm test -- packages/assets/test/asset-service.test.ts packages/assets/test/filesystem-asset-store.test.ts packages/database/test/asset-metadata-repository.test.ts
  npm test
  ```

  Expected: focused and complete suites pass; PostgreSQL suites stay visibly
  skipped without their opt-in URL.

- [x] **Step 5: Commit the application boundary**

  ```bash
  git add packages/assets/src/asset-service.ts packages/assets/test/asset-service.test.ts
  git commit -m "feat: add compensating asset service"
  ```

### Task 4: Architecture record, truthful handover, and final verification

**Files:**

- Create: `docs/adr/0007-asset-metadata-service.md`
- Create: `docs/operations/assets.md`
- Modify: `STATUS.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-09-21-asset-metadata-service.md`
- Modify: `.superpowers/sdd/asset-metadata-service/progress.md` (ignored
  ledger only)

**Interfaces:**

- Consumes: tested domain/repository/service boundaries from Tasks 1–3.
- Produces: operationally truthful M1 documentation, status handover, and
  evidence for independent review.

- [x] **Step 1: Add ADR and asset operations boundary**

  Record why canonical metadata/revision/audit is committed in a single SQL
  transaction after safe byte staging, why filesystem compensation is not
  atomicity, why malformed receipt keys are never deleted, and why
  idempotency/API/UI/deletion stay future scoped. Document the internal service
  API, receipt validation, compensation/orphan condition, and later live gate:
  Docker/PostgreSQL transaction/restart proof, real filesystem cross-integrity,
  upload/download security, reconciliation, backup linkage, and Linux ACLs.

- [x] **Step 2: Update status and changelog with evidence only**

  State the real synthetic tests and guarded PostgreSQL cases. Preserve every
  existing live blocker. Update the exact next action to the next coherent M1
  product slice after metadata foundation; do not call asset upload, browser
  attachment, live persistence, backup/recovery, migration, or cutover done.

- [x] **Step 3: Run final repository verification**

  Run:

  ```bash
  npm run verify
  npm run db:generate
  npm run build -- --listEmittedFiles
  npm audit --omit=dev --json
  git diff --check
  ```

  Expected: format, lint, strict typecheck, complete tests, schema generation,
  fresh build, production dependency audit, and whitespace checks pass. Assert
  no test source is emitted and PostgreSQL integration remains clearly skipped
  without `TEST_DATABASE_URL`.

- [x] **Step 4: Request independent review and repair valid Critical/Important findings**

  Give a fresh reviewer the design/plan, ledger, domain asset contract,
  repository adapters, service, tests, ADR/runbook, and these checks: metadata
  versus receipt matching, unsafe compensation target, no raw-byte/provenance
  leak, rollback completeness, no live claim, and no Notion action. Re-grade
  findings by user impact. For each Critical/Important finding, first add a
  focused RED regression, make the minimal GREEN repair, rerun the relevant and
  full suite, and record it in the ledger. Record true Minors as deferred.

- [x] **Step 5: Commit the documentation/evidence checkpoint**

  ```bash
  git add docs/adr/0007-asset-metadata-service.md docs/operations/assets.md STATUS.md CHANGELOG.md docs/superpowers/plans/2026-09-21-asset-metadata-service.md
  git commit -m "docs: record asset metadata verification"
  ```

## Plan self-review

- Spec coverage: Task 1 establishes canonical identity/validation/audit
  contracts; Task 2 proves transaction-shaped metadata persistence; Task 3
  proves staged receipt orchestration and explicit compensation; Task 4 records
  operational limits and verifies the repository.
- Placeholder scan: all code-producing tasks name files, interfaces, concrete
  test cases, commands, expected outcomes, and failure behavior. Deferred live
  gates are intentional non-goals rather than implementation placeholders.
- Type consistency: Task 2 consumes Task 1 `CreateAssetMutation`; Task 3
  consumes Task 2 `AssetMetadataRepository`; Task 4 documents the service from
  Task 3. Storage-key helpers remain compatible through re-export.
- Review focus: each hostile condition is assigned to an explicit task and
  test. No task accepts user-visible upload, deletion, or migration behavior.
- Deliberate gaps: transactional idempotency records, HTTP/multipart/browser
  flow, download content policy, mutable metadata, delete/retention, startup
  reconciliation, live PostgreSQL/Docker/runtime, backup integration, Linux
  operations, import, and cutover remain separately gated work.

## Execution authorization

The v2 master brief is the approved product direction, and the user has asked
for continuous autonomous execution with sensible local Git checkpoints.
Execute this plan natively in the isolated `codex/m1-asset-metadata` worktree
using TDD and a fresh final review. Do not pause for routine approval, and do
not begin Notion-related work.
