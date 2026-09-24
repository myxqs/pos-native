# Backup and Restore Operations

## Current verified boundary

NativePOS has a versioned, local `pos-native-backup` directory format and a
synthetic fixture-backed proof service in `packages/backup`. On 2026-09-25, the
currently reachable PostgreSQL application state also passed a disposable
operator rehearsal with `pg_dump`/`pg_restore`, manifest verification, database
readback, and a loopback-only application restart. This is recovery evidence,
not yet a packaged production backup command.

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

The programmatic restore result remains a clean filesystem proof containing an
opaque database-dump artifact. It does not run a database restore. The live
rehearsal below deliberately invoked PostgreSQL's tools separately, preserving
the existing source-port boundary rather than adding a Docker-specific runtime
dependency to the application.

## 2026-09-25 disposable PostgreSQL rehearsal

The rehearsal used only synthetic records and the existing local PostgreSQL 18
container. The source was dumped in PostgreSQL custom format, restored with
`--exit-on-error` into a freshly created database, and then wrapped by
`createFilesystemBackup` and accepted by `verifyFilesystemBackup`. The
published backup was:

- backup ID: `180c05f4-0f32-41d8-b092-03d3a2db58e2`;
- database artifact size: 39,598 bytes;
- database SHA-256:
  `31f346a0fefbc4ed58d118e5e2933d1b0d23cff2b4e73bf96eadbe85362dde3a`;
- canonical manifest SHA-256:
  `c0a4d522d07d37193854daecd5e1cf952f1c425ffa64beae11c63b44b1e84483`.

Readback from the final restored database established these live row counts:

| Boundary                            | Restored rows |
| ----------------------------------- | ------------: |
| users / active sessions             |         1 / 1 |
| pages / live blocks                 |         3 / 1 |
| asset metadata                      |             1 |
| sources / definitions / items       |     1 / 2 / 2 |
| scalar values / live relation edges |         1 / 1 |
| revisions / audit events            |       13 / 13 |

Identity-sensitive readback also confirmed that the child page retained its
parent UUID, the page retained its paragraph block UUID and body, the structured
records remained page-backed, the text value remained typed, and the relation
edge retained its source, definition, and target UUIDs. The built application
was then started on `127.0.0.1` against the restored database. The pre-backup
session cookie authenticated against the restored hashed session record, and
the browser retrieved the restored page tree, body, collection, records,
property revision, and relation. This directly demonstrates database and
process restart persistence for this synthetic state.

The exercise did not place credentials in the repository, did not contact
Notion, and did not modify a canonical or production database. It used a fresh
target and never overwrote a backup destination.

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

The following remain outside the accepted boundary:

1. A packaged, tested PostgreSQL backup/restore adapter. The verified rehearsal
   used PostgreSQL tools inside the disposable container because this Windows
   host has no `pg_dump` or `pg_restore` executable.
2. Programmatic refusal of a non-empty database restore target. The rehearsal
   used a fresh target but did not add or validate an automated emptiness guard.
3. Asset-byte recovery and database/filesystem cross-integrity. The reachable
   product state currently has asset metadata only; its synthetic metadata row
   was restored, but no corresponding asset byte was claimed or fabricated.
4. An explicit encrypted/offline backup policy and a production operator
   rehearsal, including a decision about active session/token lifecycle.
5. Linux deployment/permission acceptance and the later migration/cutover
   gates. Notion remains canonical throughout all of these steps.

No current backup command connects to PostgreSQL, invokes a shell utility, or
handles production credentials. A backup is never accepted solely because a
creation operation returned successfully; the relevant verification and clean
restore gates must also pass.
