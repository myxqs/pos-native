# Backup Manifest and Restore-Proof Foundation Design

**Status:** Approved implementation scope — 2026-09-21

**Authority:** The user-approved v2 product brief requires a documented,
verifiable local backup and restore path, and the user has explicitly authorised
continuous implementation. This design implements the next M1 dependency
without reopening product discovery, importing Notion data, or claiming a live
PostgreSQL rehearsal.

## Intent

Create a portable, versioned backup-directory format and a testable filesystem
service that can create, list, verify, and restore *synthetic* canonical
artifacts. It establishes the integrity and overwrite-safety boundary required
before a live PostgreSQL dump/restore adapter is introduced.

The service must back up opaque database-dump bytes and asset bytes as separate
artifacts, describe them in a canonical manifest, reject tampering and unsafe
paths, and restore only into a newly created target. The database artifact in
this slice is intentionally supplied by an injected fixture source. It models a
future PostgreSQL dump but is not evidence that PostgreSQL has been backed up
or restored.

## Considered approaches

1. **A direct `pg_dump` shell wrapper now.** This would be operationally closer
   to the final product, but Docker/PostgreSQL is unavailable and a shell
   wrapper would require credentials, process-management policy, and a clean
   database restore acceptance environment. It cannot be verified truthfully
   now.
2. **A zip/tar archive format now.** Archives add extraction, compression, and
   archive-entry traversal risk before the core integrity contract is proven.
   They can remain a future transport option around the same manifest.
3. **A directory-backed portable manifest with injected artifact sources.**
   This gives deterministic integrity, no-overwrite, and restore proof now;
   later PostgreSQL and storage adapters can implement the same source port.

Choose option 3. It is the smallest useful, provider-independent foundation
and retains a clean seam for the live adapter.

## Scope and non-goals

This slice will add:

- a `packages/backup` contract with a versioned `pos-native-backup` manifest;
- deterministic canonical manifest serialization and a checksum over the
  manifest core (excluding the checksum field itself);
- a fixture-friendly `BackupSource` port that exposes opaque database-dump
  bytes and database-authoritative asset receipts;
- filesystem create, list, verify, and restore operations using only Node
  standard-library APIs;
- fixed, generated artifact paths, SHA-256 and byte-size verification,
  regular-file checks, bounded reads, and containment checks;
- synthetic isolated-directory tests covering clean restore and hostile input;
- an ADR and an operations runbook that distinguish current proof from live
  acceptance.

It will not add:

- a `pg_dump`, `pg_restore`, shell command, Docker invocation, database
  connection string, or a claim that a live database was backed up/restored;
- a public API, browser control, background scheduler, cloud replication,
  encryption implementation, or an archive/zip format;
- PostgreSQL asset-metadata persistence, a new asset upload/download flow,
  Notion import, dual write, migration rehearsal, or cutover;
- a decision about production session/token lifecycle during a live database
  restore. The database artifact is canonical state; the operational security
  policy for restoring active credentials remains a separate live gate.

## Backup format

Each backup is an opaque native-ID directory beneath a user-controlled backup
root:

```text
<backup-root>/
  backup-<native-uuid-v4>/
    database/canonical.dump
    assets/asset-<native-uuid-v4>
    manifest.json
```

The only accepted artifact paths are exactly `database/canonical.dump` and
`assets/<validated-storage-key>`. A manifest may not select a path, filename,
drive, URL, or destination supplied by untrusted data. Original filenames stay
inside the canonical database artifact as metadata; they are never backup paths.

The format-v1 manifest is:

```ts
interface BackupManifest {
  readonly format: "pos-native-backup";
  readonly formatVersion: 1;
  readonly backupId: NativeId;
  readonly createdAt: string; // canonical Date#toISOString()
  readonly source: {
    readonly schemaVersion: string;
    readonly applicationVersion: string;
    readonly databaseDumpFormat: "postgresql-custom-v1";
    readonly assetStoreFormat: "filesystem-v1";
  };
  readonly database: {
    readonly relativePath: "database/canonical.dump";
    readonly byteSize: number;
    readonly sha256: string;
  };
  readonly assets: readonly {
    readonly assetId: NativeId;
    readonly storageKey: AssetStorageKey;
    readonly relativePath: string; // exactly assets/<storageKey>
    readonly byteSize: number;
    readonly sha256: string;
  }[];
  readonly manifestSha256: string;
}
```

`manifestSha256` is the SHA-256 digest of a fixed-key-order JSON
serialization of every field above except `manifestSha256`. The serialized
manifest itself has a trailing newline. Assets are sorted by native asset ID,
and duplicate asset IDs, storage keys, or paths are rejected. Format v1 rejects
unknown keys and unsupported versions, so it cannot silently reinterpret data.

`schemaVersion`, `applicationVersion`, `databaseDumpFormat`, and
`assetStoreFormat` are non-secret operational metadata. Database URLs,
passwords, raw tokens, file bytes, and other secrets are never included in the
manifest or logs.

## Source and filesystem contracts

The portable source port is intentionally separate from Drizzle and the current
filesystem asset adapter:

```ts
interface BackupSource {
  readonly metadata: BackupSourceMetadata;
  readDatabaseDump(): Promise<Uint8Array>;
  listAssets(): Promise<readonly BackupSourceAsset[]>;
  readAsset(asset: BackupSourceAsset): Promise<Uint8Array>;
}
```

Each `BackupSourceAsset` has a native asset ID, a validated opaque storage key,
and the database-authoritative size/checksum receipt. Creation compares the
bytes returned from the source with that receipt before writing. This gives a
future PostgreSQL metadata source and filesystem `AssetStore` a single explicit
cross-integrity point, while current tests use a deterministic in-memory
fixture.

`createFilesystemBackup(root, source, options)` creates a new
`backup-<id>` directory using a non-recursive create and refuses an existing ID
instead of overwriting it. It writes bounded database and asset artifacts, then
verifies their receipts and writes `manifest.json` last. A failure cleans only
the directory created for that generated/validated backup ID; a directory with
no manifest is never listed or accepted as a backup.

`verifyFilesystemBackup(root, backupId, options)` validates the manifest and
re-reads every fixed artifact through regular-file/no-symlink checks, bounded
reads, size comparison, and SHA-256 comparison. It does not modify the source.

`restoreFilesystemBackup(root, backupId, target, options)` verifies the source
first, then requires `target` not to exist. It creates the target itself,
copies only verified fixed-layout artifacts, revalidates the persisted result,
and writes the manifest last. It removes only its own newly created target when
a recoverable copy failure occurs. It never overwrites an existing directory or
database target.

The API requires a positive safe-integer `maxArtifactBytes`; there is no
unbounded default. The current in-memory source is therefore intentionally
bounded. A future production adapter that needs very large dumps must add a
tested streaming path rather than weakening this limit.

## Safety and failure model

- Roots are configured by the operator, resolved/canonicalised, and never made
  from request or manifest input.
- Backup IDs, native asset IDs, storage keys, hashes, timestamps, metadata
  tokens, and all paths are runtime-validated.
- Manifest file, backup directory, database artifact, and asset artifacts must
  be regular non-symbolic-link filesystem entries. File identity is checked
  around opened bounded reads to resist replacement between inspection and read.
- A source receipt mismatch, duplicate inventory, missing artifact, invalid
  JSON, unsupported format, checksum mismatch, size mismatch, traversal-shaped
  path, or non-regular entry fails closed.
- Listing is discovery only: it returns manifest-bearing backup IDs but does
  not imply full integrity verification. The runbook makes verification an
  explicit required operation.
- Manifest versioning makes the format replaceable. The directory is a local
  backup, not the portable open-export feature.

## Acceptance evidence for this slice

- deterministic manifest serialization/checksum and sort order from a
  synthetic source;
- a backup directory with database and multiple asset artifacts verifies after
  creation;
- restored artifacts and manifest verify in a clean isolated target;
- creation and restore refuse existing targets without changing their files;
- malformed/unsupported manifests, duplicate entries, unsafe paths, symlinks,
  missing/truncated/tampered artifacts, source-receipt mismatches, and partial
  directories fail closed;
- formatter, lint, strict typecheck, complete test suite, fresh build,
  dependency audit, and Git whitespace checks pass;
- documentation states clearly that live PostgreSQL backup/restore, database
  transactional consistency, runtime readback, Docker/restart acceptance, and
  migration/cutover remain unverified.
