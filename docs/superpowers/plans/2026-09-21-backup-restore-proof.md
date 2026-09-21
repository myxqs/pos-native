# Backup Manifest and Restore-Proof Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a safe, versioned local backup-directory format with
synthetic create, list, verify, and clean-restore proof, without claiming a
live PostgreSQL backup or restore.

**Architecture:** Put pure manifest construction/validation in
`packages/backup/src/backup-manifest.ts`, then put filesystem operations behind
an injected `BackupSource` port in `filesystem-backup.ts`. The source owns how
an opaque PostgreSQL dump and canonical asset receipts are obtained; this slice
uses deterministic fixture sources only. The filesystem service owns fixed
artifact paths, no-overwrite directories, verification, and safe clean restore.

**Tech Stack:** TypeScript 6 strict mode, Node standard-library `crypto`,
`fs/promises`, and `path`, existing domain and asset validation ports, Vitest 5.

**Spec:**
`docs/superpowers/specs/2026-09-21-backup-restore-proof-design.md`

## Global Constraints

- Add no dependency and do not run a package install.
- The format is `pos-native-backup` version `1`; reject unknown manifest keys
  and unsupported versions instead of guessing a compatibility path.
- Backups use only `backup-<native-uuid-v4>/database/canonical.dump`,
  `assets/<opaque-storage-key>`, and `manifest.json`; neither user filenames
  nor manifest data choose an operating-system path.
- Require an explicit positive safe-integer `maxArtifactBytes` for creation,
  verification, and restore. Never use unbounded `readFile` for an artifact.
- Validate every native ID, storage key, checksum, timestamp, source metadata,
  receipt, and filesystem entry at runtime; regular files only, no symlinks.
- Manifest checksum covers a fixed-key-order core that excludes its own checksum;
  file checksums use lowercase SHA-256 hex.
- Create refuses an existing backup ID. Restore refuses any existing target
  directory and cleans only a target it created itself after a failed copy.
- `manifest.json` is written last. Listing is discovery only and is not a
  substitute for full integrity verification.
- Keep the scope synthetic: no shell, Docker, `pg_dump`, credentials, public
  route, browser UI, cloud dependency, Notion work, or canonical cutover.
- Keep database URLs, passwords, raw token values, and artifact bytes out of
  manifests, logs, status, and tests.

## Review Focus

- A tampered or malformed manifest must fail before verification/restore reads
  or writes an artifact; Task 1 owns parser/checksum/strict-shape tests.
- Windows drive, UNC, backslash, absolute, and `..` path spellings must never
  escape a backup or restore root; Task 1 owns path-shape validation and Task 2
  owns filesystem containment tests.
- Duplicate native asset IDs, storage keys, or generated relative paths must
  be rejected before a backup is published; Task 1 owns pure validation and
  Task 2 owns source-inventory refusal/cleanup evidence.
- A symlink, replacement, oversized, missing, truncated, or altered artifact
  must fail closed and preserve outside bytes; Task 2 owns regular-file,
  bounded-read, and tamper tests.
- An existing backup or restore target must never be overwritten, including if
  source verification fails; Task 2 owns no-overwrite and target-absence tests.

---

### Task 1: Portable backup-manifest contract and strict parser

**Files:**

- Create: `packages/backup/src/backup-manifest.ts`
- Create: `packages/backup/test/backup-manifest.test.ts`

**Interfaces:**

- Consumes: `NativeId`, `asNativeId`, and `ValidationError` from
  `packages/domain/src/ids.ts`; `AssetStorageKey` and `asAssetStorageKey` from
  `packages/assets/src/asset-storage.ts`.
- Produces: `BackupManifest`, `BackupManifestInput`, `BackupSourceMetadata`,
  `BackupSourceAsset`, `BACKUP_FORMAT`, `BACKUP_FORMAT_VERSION`,
  `DATABASE_ARTIFACT_PATH`, `assetBackupRelativePath`, `sha256ForBytes`,
  `createBackupManifest`, `serializeBackupManifest`, and
  `parseBackupManifest` for Task 2.

- [x] **Step 1: Write the failing manifest tests**

  Create `packages/backup/test/backup-manifest.test.ts`. Use fixed UUID-v4
  values, a fixed `2026-09-21T00:00:00.000Z` timestamp, and two assets passed
  in reverse ID order. Pin these public expectations:

  ```ts
  const manifest = createBackupManifest({
    backupId: asNativeId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    createdAt: "2026-09-21T00:00:00.000Z",
    source: {
      schemaVersion: "0004",
      applicationVersion: "0.1.0",
      databaseDumpFormat: "postgresql-custom-v1",
      assetStoreFormat: "filesystem-v1",
    },
    database: {
      relativePath: "database/canonical.dump",
      byteSize: 7,
      sha256: sha256ForBytes(new TextEncoder().encode("database")),
    },
    assets: reversedAssets,
  });

  expect(manifest.format).toBe("pos-native-backup");
  expect(manifest.formatVersion).toBe(1);
  expect(manifest.assets.map((asset) => asset.assetId)).toEqual(sortedIds);
  expect(parseBackupManifest(serializeBackupManifest(manifest))).toEqual(
    manifest,
  );
  ```

  Add separate tests that alter one serialized core character while retaining
  the old checksum, add an unknown top-level key, use format version `2`, use
  a non-canonical timestamp, and inject duplicate asset IDs/storage keys. Add
  parameterized path cases for `../escape`, `/absolute`, `C:\\drive`,
  `\\\\server\\share`, `assets\\asset-...`, and a valid key paired with a
  non-canonical relative path. Each must throw `ValidationError` through the
  public constructor/parser.

- [x] **Step 2: Run the manifest test to verify RED**

  Run:

  ```bash
  npm test -- packages/backup/test/backup-manifest.test.ts
  ```

  Expected: FAIL because the backup package/module does not exist.

- [x] **Step 3: Implement the pure manifest boundary**

  Create `backup-manifest.ts` with these precise structures:

  ```ts
  export const BACKUP_FORMAT = "pos-native-backup" as const;
  export const BACKUP_FORMAT_VERSION = 1 as const;
  export const DATABASE_ARTIFACT_PATH = "database/canonical.dump" as const;

  export interface BackupSourceMetadata {
    readonly schemaVersion: string;
    readonly applicationVersion: string;
    readonly databaseDumpFormat: "postgresql-custom-v1";
    readonly assetStoreFormat: "filesystem-v1";
  }

  export interface BackupSourceAsset {
    readonly assetId: NativeId;
    readonly storageKey: AssetStorageKey;
    readonly byteSize: number;
    readonly sha256: string;
  }

  export interface BackupArtifactDescriptor {
    readonly relativePath: string;
    readonly byteSize: number;
    readonly sha256: string;
  }

  export interface BackupAssetDescriptor
    extends BackupSourceAsset, BackupArtifactDescriptor {}
  ```

  `BackupManifestInput` omits the static format/version/checksum fields;
  `BackupManifest` adds them. `assetBackupRelativePath(key)` must return only
  `assets/${asAssetStorageKey(key)}`. `sha256ForBytes` uses Node SHA-256 and
  lowercase hex.

  Build normalized objects in fixed literal-key order, sort assets by
  `assetId`, and reject duplicate IDs, keys, and relative paths. Validate that
  all byte sizes are non-negative safe integers, hashes match
  `/^[a-f0-9]{64}$/`, timestamps round-trip through `Date#toISOString()`,
  version/configuration tokens match `/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/`,
  and descriptor paths exactly match the two fixed layouts. Strict parsing must
  check every object has exactly its v1 keys before constructing the normalised
  manifest. Hash the fixed-key-order core without `manifestSha256`, append that
  field, and serialize with two-space indentation plus one trailing newline.

- [x] **Step 4: Run focused tests and strict typecheck**

  Run:

  ```bash
  npm test -- packages/backup/test/backup-manifest.test.ts
  npm run typecheck
  ```

  Expected: all manifest cases pass and TypeScript is clean.

- [x] **Step 5: Commit the manifest boundary**

  ```bash
  git add packages/backup/src/backup-manifest.ts packages/backup/test/backup-manifest.test.ts
  git commit -m "feat: add backup manifest contract"
  ```

### Task 2: Safe synthetic filesystem backup, verify, and clean restore

**Files:**

- Create: `packages/backup/src/filesystem-backup.ts`
- Create: `packages/backup/test/filesystem-backup.test.ts`

**Interfaces:**

- Consumes: all public manifest functions/types from Task 1, including
  fixed artifact paths and `BackupSourceAsset` receipts.
- Produces: `BackupSource`, `BackupOperationOptions`,
  `createFilesystemBackup`, `listFilesystemBackups`,
  `verifyFilesystemBackup`, and `restoreFilesystemBackup` for Task 3 and
  future live adapters.

- [x] **Step 1: Write failing isolated-filesystem tests**

  Create `filesystem-backup.test.ts` with `mkdtemp`/`rm` cleanup and a
  deterministic fixture source. The fixture must expose `metadata`, database
  bytes `"synthetic database dump"`, and two opaque asset keys with expected
  SHA-256 receipts. Use `maxArtifactBytes: 1024`, a fixed backup ID, and a
  fixed date. Add tests that prove:

  ```ts
  const created = await createFilesystemBackup(root, fixture, options);
  expect(await listFilesystemBackups(root)).toEqual([options.backupId]);
  expect(await verifyFilesystemBackup(root, options.backupId, options)).toEqual(
    created.manifest,
  );

  const restored = await restoreFilesystemBackup(
    root,
    options.backupId,
    restoreRoot,
    options,
  );
  expect(
    await readFile(join(restored.directory, "database", "canonical.dump")),
  ).toEqual(databaseBytes);
  expect(
    await verifyFilesystemBackup(
      restored.backupRoot,
      options.backupId,
      options,
    ),
  ).toEqual(created.manifest);
  ```

  Keep the restored backup layout rooted at `restoreRoot/backup-<id>` so the
  same verifier can be used after restore. Add separate tests that:

  1. create with a duplicate ID and prove original manifest/artifacts remain;
  2. restore into a root containing the same backup directory and prove its
     sentinel file remains and is not overwritten;
  3. alter an asset after creation and assert verify/restore reject while no
     restore output is created;
  4. make the fixture return bytes that disagree with its canonical source
     receipt and assert creation rejects and publishes no listable backup;
  5. pre-create a `backup-<id>` directory with no manifest and assert list
     excludes it while verify rejects it;
  6. place a symbolic-link artifact pointing outside and assert verification
     rejects without reading the outside bytes. If symbolic links are denied
     with `EPERM`, skip only this test with the explicit host reason;
  7. pass zero/unsafe `maxArtifactBytes`, a too-small cap, and an existing
     restore backup directory; each must fail before changing an existing
     target.

- [x] **Step 2: Run the filesystem test to verify RED**

  Run:

  ```bash
  npm test -- packages/backup/test/filesystem-backup.test.ts
  ```

  Expected: FAIL because `filesystem-backup.ts` does not exist.

- [x] **Step 3: Implement the injected source and filesystem service**

  Define:

  ```ts
  export interface BackupSource {
    readonly metadata: BackupSourceMetadata;
    readDatabaseDump(): Promise<Uint8Array>;
    listAssets(): Promise<readonly BackupSourceAsset[]>;
    readAsset(asset: BackupSourceAsset): Promise<Uint8Array>;
  }

  export interface BackupOperationOptions {
    readonly backupId?: NativeId;
    readonly createdAt?: Date;
    readonly maxArtifactBytes: number;
  }
  ```

  `createFilesystemBackup(root, source, options)` makes/canonicalises the
  configured root, obtains `backupId` from `options` or `randomUUID()`, and
  creates exactly `backup-<id>` with non-recursive `mkdir`. An existing target
  becomes `ValidationError`; it is never removed or overwritten. Copy source
  bytes before asynchronous writes, enforce the explicit cap, compare each
  asset's returned bytes to its source receipt, create fixed artifacts with
  exclusive files and mode `0o600`, and write the canonical manifest last.
  Verify the finished backup before returning. On error, remove only the
  directory this call created; preserve an aggregate error if safe cleanup
  itself fails.

  `verifyFilesystemBackup(root, backupId, options)` must canonicalise the
  configured root, derive the directory from the validated ID, read a regular
  non-symlink manifest through a bounded handle, parse it, require it matches
  the requested ID, then re-read every fixed artifact through one opened,
  identity-checked, bounded handle and compare its size/checksum. Do not use
  arbitrary manifest paths or unbounded `readFile` for artifacts.

  `restoreFilesystemBackup(sourceRoot, backupId, targetRoot, options)` calls
  source verification before creating anything under `targetRoot`. It requires
  `targetRoot/backup-<id>` not to exist, creates that child itself, copies each
  independently re-verified artifact into the same fixed layout with exclusive
  files, writes the canonical manifest last, then verifies the restored tree.
  It never runs a database restore: the returned directory is a verified
  filesystem restore proof containing an opaque database-dump artifact.

  `listFilesystemBackups(root)` returns sorted valid-ID directories only when a
  non-symlink `manifest.json` exists. It deliberately does not declare their
  contents verified.

  Use `lstat`, `O_NOFOLLOW` where available, opened-handle `stat`, post-open
  `lstat`/device/inode comparison, and chunked reads capped at
  `maxArtifactBytes`; reject directories, links, replacement, and growth.
  Derive all child paths through an internal containment helper that rejects
  `..`, absolute/drive/UNC/backslash paths. Keep all exceptions free of bytes,
  passwords, URLs, and raw artifact content.

- [x] **Step 4: Run focused tests, lint, and strict typecheck**

  Run:

  ```bash
  npm test -- packages/backup/test/backup-manifest.test.ts packages/backup/test/filesystem-backup.test.ts
  npm run lint
  npm run typecheck
  ```

  Expected: all backup cases pass; any symbolic-link skip has an explicit host
  reason; lint and strict TypeScript pass.

- [x] **Step 5: Commit the filesystem proof**

  ```bash
  git add packages/backup/src/filesystem-backup.ts packages/backup/test/filesystem-backup.test.ts
  git commit -m "feat: add backup restore proof"
  ```

### Task 3: Operations truthfulness, final verification, and review checkpoint

**Files:**

- Create: `docs/adr/0006-backup-manifest-restore-proof.md`
- Modify: `docs/operations/backup-restore.md`
- Modify: `STATUS.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-09-21-backup-restore-proof.md`
- Modify: `.superpowers/sdd/backup-restore-proof/progress.md` (ignored ledger only)

**Interfaces:**

- Consumes: Task 1's manifest format and Task 2's fixture-backed filesystem
  operations.
- Produces: truthful operator/developer documentation and M1 handover while
  leaving live PostgreSQL, application runtime, and migration acceptance gated.

- [x] **Step 1: Add ADR and update the backup/restore runbook**

  Record ADR-0006 selecting a directory-backed manifest as the portable local
  backup foundation, source-port separation from `pg_dump`, fixed paths,
  checksums, manifest-last publication, and clean-target refusal. In
  `docs/operations/backup-restore.md`, document the current programmatic
  operations and their meanings:

  - create: fixture/source-backed directory creation and immediate verify;
  - list: discovery only, not integrity acceptance;
  - verify: full manifest/artifact checks with no mutation;
  - restore: clean-directory filesystem proof, not a live database restore.

  Include a concise live-gate checklist: Docker/PostgreSQL availability,
  `pg_dump`/`pg_restore` adapter, clean database restore refusal, migration and
  audit/revision readback, asset metadata cross-integrity, restart proof,
  encrypted/offline backup policy, and an operator rehearsal. State that no
  command currently connects to PostgreSQL or handles production secrets.

- [x] **Step 2: Update status and changelog evidence**

  State the actual test result, bounded synthetic source coverage, manifest
  format, checksum/path/no-overwrite behavior, and clean filesystem restore
  proof. Preserve explicit blockers for Docker, live PostgreSQL persistence,
  backup/restore rehearsal, browser attachment flow, deployment, migration,
  and cutover. Set the next action to PostgreSQL asset-metadata integration or
  the next dependency supported by the current environment; never claim a
  completed live backup.

- [x] **Step 3: Run full verification and repository checks**

  Run:

  ```bash
  npm run verify
  npm run db:generate
  npm run build -- --listEmittedFiles
  npm audit --omit=dev --json
  git diff --check
  ```

  Expected: formatting, lint, strict typecheck, full tests, schema generation,
  fresh production build, production dependency audit, and whitespace checks
  pass. Assert the build emits no test source. The two opt-in PostgreSQL tests
  remain skipped without `TEST_DATABASE_URL`.

- [x] **Step 4: Request independent review and repair each Important finding**

  Give the reviewer this design/plan, `packages/backup`, the ADR/runbook, and
  these constraints: no unsafe path or link handling, no overwrite, no secret
  leakage, no live PostgreSQL claim, no Notion action. For each valid Critical
  or Important finding, add a focused regression test first, observe RED,
  make the smallest repair, rerun focused and full verification, and record it
  in the plan ledger. Record Minors as deferred ledger items.

- [x] **Step 5: Commit the evidence checkpoint**

  ```bash
  git add docs/adr/0006-backup-manifest-restore-proof.md docs/operations/backup-restore.md STATUS.md CHANGELOG.md docs/superpowers/plans/2026-09-21-backup-restore-proof.md
  git commit -m "docs: record backup restore proof verification"
  ```

## Plan self-review

- Spec coverage: Task 1 fixes the portable format/validation boundary; Task 2
  implements source separation, create/list/verify/restore and synthetic
  integrity evidence; Task 3 supplies truthful operations/review evidence.
- Placeholder scan: no placeholder marker, vague error-handling step, or deferred source
  implementation marker appears in executable tasks; live gates are explicit
  non-goals rather than hidden work.
- Type consistency: Task 2 consumes the exact manifest types and fixed paths
  named in Task 1; Task 3 documents the names Task 2 produces.
- Review focus: all five hostile conditions are assigned to concrete Task 1 or
  Task 2 test cases.
- Deliberate gaps: actual `pg_dump`/`pg_restore`, Docker, database transaction
  consistency, token/session restore policy, encryption, deployment, API/UI,
  Notion migration, and cutover remain separate gates.

## Execution authorization

The v2 master brief is the approved product direction, and the user has asked
for continuous autonomous execution with sensible checkpoints. Execute this
plan natively in the isolated worktree using TDD and a fresh final review; do
not wait for routine approval or start any Notion-related work.
