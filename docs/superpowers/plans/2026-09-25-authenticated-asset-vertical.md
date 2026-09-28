# Authenticated Asset Vertical Implementation Plan

> **Execution:** Follow this plan task by task using strict RED → GREEN →
> REFACTOR. Do not combine checkpoints, install a multipart dependency, touch
> Notion, use personal data, or broaden the slice.

**Goal:** Make the existing NativePOS asset foundation reachable through the
authenticated loopback application, then prove database plus filesystem asset
backup, clean restore, restart persistence, and browser retrieval using only
synthetic data.

**Architecture:** Extend the existing asset domain/service/store/repository
boundaries. Add raw `application/octet-stream` routes with strict metadata
headers and server-derived actors, compose them in the production runtime, add
a minimal browser surface, then extend the existing manifest-backed recovery
operator to include verified asset bytes. PostgreSQL remains canonical for
metadata; the filesystem remains canonical for bytes.

**Stack:** TypeScript 6, Fastify 5, Drizzle/PostgreSQL 18, browser DOM APIs,
Vitest, existing filesystem asset store, existing Docker recovery operator.

**Approved design:**
`docs/superpowers/specs/2026-09-25-authenticated-asset-vertical-design.md`

## File map

Create:

- `apps/api/src/asset-routes.ts` — authenticated upload/list/download contract.
- `apps/api/test/asset-routes.test.ts` — route security, validation, bounds,
  actor, integrity, and safe-error proof.
- `apps/api/test/production-assets.integration.test.ts` — opt-in PostgreSQL plus
  filesystem runtime proof.
- `packages/backup/src/asset-backup-source.ts` — strict receipt parsing and
  verified filesystem asset source for the backup manifest.
- `packages/backup/src/asset-restore.ts` — clean-root staging, compensation,
  and post-restore cross-integrity checks.
- `packages/backup/test/asset-backup-source.test.ts` — strict projection and
  byte-integrity tests.
- `packages/backup/test/asset-restore.test.ts` — no-overwrite, compensation,
  and restored-byte verification tests.

Modify:

- `packages/database/src/asset-metadata-repository.ts` — bounded list contract.
- `packages/database/src/postgres-asset-metadata-repository.ts` — SQL limit.
- `packages/database/test/asset-metadata-repository.test.ts` — deterministic
  bound coverage.
- `packages/database/test/postgres-asset-metadata-repository.integration.test.ts`
  — live bounded-list proof.
- `apps/api/src/app.ts` — route dependency composition and octet-stream parser.
- `apps/api/src/runtime.ts` — required asset root, byte limit, store/service and
  repository composition, cleanup on failure.
- `apps/api/test/app.test.ts`, `apps/api/test/runtime.test.ts` — composition and
  fail-closed configuration proof.
- `apps/web/index.html`, `apps/web/app.js`, `apps/web/app.d.ts`,
  `apps/web/styles.css`, `apps/api/test/web-shell.test.ts` — minimal accessible
  upload/list/download UI and controller tests.
- `packages/backup/src/postgres-recovery.ts`,
  `packages/backup/src/docker-postgres-driver.ts`,
  `packages/backup/test/postgres-recovery.test.ts`, and
  `packages/backup/test/docker-postgres-driver.test.ts` — asset receipt
  projection and asset-aware recovery orchestration.
- `scripts/postgres-recovery.mjs` — required asset roots for full-state backup
  and restore; keep database-only behavior explicitly named.
- `package.json` — no new dependency; retain the existing operator command.
- `docs/operations/assets.md`, `docs/operations/backup-restore.md`,
  `docs/architecture/security.md`, and `STATUS.md` — exact accepted behavior,
  evidence, limits, cleanup, and remaining gates.

## Task 1: Bound asset metadata reads at the repository

**Files:** repository interface/implementations and their two test files listed
above.

1. Add failing in-memory tests proving `list(limit)` returns the oldest assets
   in `(createdAt, id)` order, enforces the requested bound, and rejects zero,
   negative, fractional, and unsafe limits.
2. Run:

   ```powershell
   npm test -- packages/database/test/asset-metadata-repository.test.ts
   ```

   Confirm failure because `list` has no limit contract.

3. Change `AssetMetadataRepository.list(limit)` and the in-memory adapter with a
   shared positive-safe-integer validator.
4. Add a failing opt-in PostgreSQL test proving the SQL adapter returns the same
   deterministic bounded order. Run it with `TEST_DATABASE_URL` and confirm the
   expected failure.
5. Add `.limit(limit)` to the PostgreSQL query and rerun both files.
6. Run `npm run typecheck` to locate every caller and update only deliberate
   call sites.
7. Commit locally:

   ```text
   feat(assets): bound metadata listing
   ```

## Task 2: Add authenticated upload route

**Files:** new asset route and route test; modify `app.ts` and `app.test.ts`.

1. Add failing route tests for:
   - unauthenticated `401` before body handling;
   - missing/incorrect CSRF refusal;
   - unsupported content type;
   - missing, duplicated, malformed-percent, path-like, controlled, or
     oversized filename header;
   - invalid declared MIME header;
   - body over the configured maximum without service invocation;
   - successful `201` with metadata only and the actor ID/type derived from the
     authenticated session despite any client body/header attempt.
2. Run `npm test -- apps/api/test/asset-routes.test.ts` and observe the missing
   route failure.
3. Implement a route-local `application/octet-stream` parser and bounded body
   handling. Decode `X-NativePOS-Filename` exactly once and delegate canonical
   validation to `AssetService`; use `X-NativePOS-Media-Type` only as declared
   metadata.
4. Map validation/size failures to fixed `400`/`413` responses and all unknown
   storage/database failures to fixed `500` without internal details.
5. Rerun the route tests, then `apps/api/test/app.test.ts`.
6. Commit locally:

   ```text
   feat(api): add authenticated asset upload
   ```

## Task 3: Add bounded list and integrity-gated download routes

**Files:** the asset route and route tests.

1. Add failing tests proving:
   - list requires authentication, defaults to 50, accepts 1–100 only, and
     preserves repository order;
   - download validates a native UUID and returns `404` for absent metadata;
   - verified bytes return fixed attachment headers, `nosniff`, exact length,
     and `application/octet-stream`;
   - missing, changed, oversized, symlinked, or checksum-mismatched storage
     returns fixed `409` without paths, filenames, checksums, or exception text.
2. Run the focused test and confirm failures.
3. Implement list/get through `AssetMetadataRepository`; download only after
   `AssetStore.read` and size/SHA-256 comparison with canonical metadata.
4. Rerun focused API tests plus authentication/page/block/data-source route
   suites to catch boundary regressions.
5. Commit locally:

   ```text
   feat(api): expose verified asset reads
   ```

## Task 4: Compose persistent assets in the production runtime

**Files:** `runtime.ts`, runtime tests, and the new production integration file.

1. Add failing runtime tests for required nonblank `POS_ASSET_ROOT`, positive
   safe `POS_MAX_ASSET_BYTES`, construction failure cleanup, and persistence
   close after a later composition/listener failure.
2. Add a failing opt-in integration test that starts production composition
   against PostgreSQL plus an isolated asset root, creates a synthetic asset
   through HTTP, reads metadata/revision/audit rows, and downloads identical
   bytes.
3. Run both tests and confirm the missing composition failure.
4. Construct `FilesystemAssetStore`, `PostgresAssetMetadataRepository`, and
   `AssetService` using the shared `newId`/`now` dependencies. Register routes
   only when all asset dependencies exist.
5. Ensure startup failure closes PostgreSQL and does not delete or broaden the
   configured asset root.
6. Rerun focused runtime/integration tests.
7. Commit locally:

   ```text
   feat(runtime): persist authenticated assets
   ```

## Task 5: Add the minimal browser asset workspace

**Files:** web assets and `web-shell.test.ts`.

1. Add failing controller/DOM tests for:
   - asset list loads only after authenticated session confirmation;
   - file selection sends raw bytes, encoded filename, declared MIME, and CSRF;
   - upload controls disable while pending and refresh the list on success;
   - late upload/list responses cannot overwrite newer authenticated state;
   - safe fixed errors contain no server response details;
   - metadata uses `textContent` and remains safe with hostile filenames;
   - download uses an authenticated fetch, a temporary object URL, the
     metadata filename only as the DOM download attribute, and always revokes;
   - keyboard operation and the existing narrow viewport keep controls usable.
2. Run the focused web-shell test and confirm failures.
3. Add the smallest Assets region: file input, Upload button, status, bounded
   list, and Download buttons. Do not add preview, page linkage, deletion, or
   drag/drop.
4. Rerun the full web-shell test file and manually inspect desktop and narrow
   browser snapshots using synthetic metadata.
5. Commit locally:

   ```text
   feat(web): add local asset workspace
   ```

## Task 6: Include verified asset bytes in backup creation

**Files:** new asset backup source/tests plus recovery driver, orchestrator,
operator script, and their tests.

1. Add failing tests for strict bounded parsing of the PostgreSQL asset receipt
   projection: malformed field counts, UUID/key mismatch, unsafe size/checksum,
   duplicates, and extra output all fail.
2. Add failing tests proving backup reads only manifest-declared opaque keys,
   rejects missing/symlinked/changed/mismatched files, and publishes nothing on
   failure.
3. Extend the Docker driver with one fixed machine-output query. Do not accept
   SQL, paths, storage keys, or checksums from CLI arguments.
4. Add `--asset-root` to the full-state backup operation and compose the
   receipt projection with `FilesystemAssetStore` through the existing
   `BackupSource` port. Keep an explicitly named database-only library helper
   for tests/diagnosis; the operator's normal backup must be full-state.
5. Rerun every backup package test.
6. Commit locally:

   ```text
   feat(backup): include verified asset bytes
   ```

## Task 7: Restore asset bytes with compensation and cross-integrity

**Files:** new asset restore module/tests plus recovery orchestration and CLI.

1. Add failing tests proving complete verification happens before target
   changes and a non-empty asset root is refused without touching it.
2. Add failing tests for successful no-overwrite staging, database restore
   failure compensation, compensation failure reporting, and exact restored
   metadata/manifest/byte agreement.
3. Implement clean-root validation using regular-directory/no-symlink checks.
   Stage only manifest identities; never broadly delete or clean a target.
4. Restore the PostgreSQL dump with the existing clean-target guard and single
   transaction. On failure, discard only keys staged by this invocation.
5. Query restored metadata, compare it exactly with manifest receipts, and
   verify every restored file before reporting success.
6. Extend the restore CLI with required `--asset-root`; emit only safe IDs and
   manifest checksum.
7. Rerun all backup/recovery tests.
8. Commit locally:

   ```text
   feat(backup): restore asset bytes safely
   ```

## Task 8: Full live synthetic acceptance

**Files:** no product changes unless a failure first receives a regression
test. Use fresh disposable database and asset-root names; never delete existing
resources.

1. Verify `docker info`, then create a fresh database, apply migrations, and
   bootstrap a synthetic owner using an interactive synthetic password that is
   not logged or committed.
2. Start the production build on loopback with a fresh asset root.
3. In a real browser, verify login, upload of a small known synthetic file,
   bounded list, download byte equality, logout refusal, login/session restore,
   CSRF refusal, and fixed errors.
4. Stop the process, restart it, and verify retrieval. Restart the disposable
   PostgreSQL container, start another process, and verify retrieval again.
5. Run the full-state backup operator. Record manifest and artifact checksums.
   Prove duplicate backup refusal leaves the accepted backup unchanged.
6. Restore into a new empty database and new empty asset root. Compare all
   canonical table counts and deterministic row hashes, every asset receipt,
   and every asset byte hash.
7. Prove non-empty database and non-empty asset-root refusals leave both targets
   unchanged. Tamper a disposable copy—not the accepted backup—and prove
   verification fails before target mutation.
8. Start production runtime against both restored targets and re-download the
   exact bytes in the browser.
9. Leave all disposable resources intact and record exact scoped cleanup
   commands without executing them.

## Task 9: Review, verify, document, and preserve

**Files:** status, asset/recovery/security operations documentation, and any
confirmed review fixes with their regression tests.

1. Update documentation with exact evidence and explicit remaining limits:
   no malware scanning, inline rendering, deletion, page linkage, Linux/home
   server acceptance, personal files, or Notion access.
2. Run:

   ```powershell
   npm run verify
   # Set TEST_DATABASE_URL process-locally to the fresh disposable database.
   npm test -- --no-file-parallelism
   npm run build
   npm audit --omit=dev --json
   npm run db:generate
   npm run db:migrate
   git diff --check
   ```

3. Record exact passed/skipped counts. Treat every skip as unverified.
4. Run one Open Code Review delegation preview for the coherent implementation
   range, obtain rules for every reviewable file, and review every file with the
   host model. Validate findings before changing code.
5. For each confirmed finding, add or adjust a failing test first, apply the
   smallest repair, and rerun focused plus full verification.
6. Commit documentation/review repairs locally. Do not merge or push.
7. Confirm a clean worktree and report disposable resources, safe cleanup,
   commits, live acceptance, remaining gates, and the next dependency-ordered
   product action.

## Completion boundary

This plan is complete only when the real loopback browser can upload and
download synthetic bytes through persistent PostgreSQL/filesystem adapters and
the same bytes survive verified full-state backup, clean restore, application
restart, and PostgreSQL-container restart. Passing unit tests alone is not
completion.
