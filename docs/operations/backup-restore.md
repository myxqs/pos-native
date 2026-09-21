# Backup and Restore Operations

## Current verified boundary

NativePOS now has a versioned, local `pos-native-backup` directory format and a
synthetic fixture-backed proof service in `packages/backup`. It is an M1
foundation, not a completed live database backup feature.

Each backup uses a generated `backup-<native-uuid>` directory with only these
fixed paths:

```text
backup-<native-uuid>/
  database/canonical.dump
  assets/asset-<native-uuid>
  manifest.json
```

`manifest.json` contains version/configuration metadata, artifact byte counts,
SHA-256 checksums, and a checksum over its canonical core. It contains no
database URL, password, raw API/session token, user filename, or artifact byte
content. The file is written only after the database and asset artifacts have
been staged and verified.

## Current programmatic operations

The API is deliberately source-injected while live PostgreSQL is unavailable:

```ts
createFilesystemBackup(backupRoot, source, options);
listFilesystemBackups(backupRoot);
verifyFilesystemBackup(backupRoot, backupId, options);
restoreFilesystemBackup(sourceRoot, backupId, targetRoot, options);
```

- `createFilesystemBackup` accepts opaque source bytes and canonical asset
  receipts, requires an explicit positive safe byte cap, creates a new
  `backup-<id>` directory, immediately verifies it, and refuses an existing ID.
- `listFilesystemBackups` is discovery only. It lists directories with a
  regular `manifest.json`; it does not declare their contents verified.
- `verifyFilesystemBackup` is non-mutating. It validates the strict manifest,
  fixed paths, regular-file/no-symlink boundary, byte limits, file identity,
  byte counts, and checksums.
- `restoreFilesystemBackup` verifies the source first and only then creates a
  missing `targetRoot/backup-<id>` child. It refuses any existing target,
  copies the opaque artifacts into the same fixed layout, writes the manifest
  last, and verifies the resulting directory.

The current restore result is a clean filesystem proof containing an opaque
database-dump artifact. It does not run a database restore.

## Current evidence and operational boundary

The test suite covers deterministic manifest ordering/checksums, malformed and
tampered manifests, unsafe path spellings, duplicate identities, source receipt
mismatch, missing/partial directories, artifact alteration, symbolic-link
refusal where the host permits symlink tests, bounded reads, and no-overwrite
creation/restore. Tests use isolated temporary directories and synthetic bytes.

Do not put backup directories, database dumps, asset bytes, `.env`, or secrets
under source control. Keep eventual backup roots on user-controlled private
storage; no cloud provider is required by this format.

## Live acceptance gates still required

The following are not implemented or accepted by this proof:

1. A tested PostgreSQL `pg_dump`/`pg_restore` adapter after Docker/PostgreSQL is
   available.
2. Restore refusal for a non-empty live database and a clean live database
   restore into a separate target.
3. Database migration, revision, audit, foreign-key, and asset-metadata
   cross-integrity readback after restore.
4. Application restart and authenticated retrieval against the restored state.
5. An explicit encrypted/offline backup policy and a production operator
   rehearsal, including a decision about active session/token lifecycle.
6. Linux deployment/permission acceptance and the later migration/cutover
   gates. Notion remains canonical throughout all of these steps.

No current backup command connects to PostgreSQL, invokes a shell utility, or
handles production credentials. A backup is never accepted solely because a
creation operation returned successfully; the relevant verification and clean
restore gates must also pass.
