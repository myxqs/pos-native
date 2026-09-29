# Backup and Restore Operations

## M6 production-local wrapper

`scripts/nativepos.ps1 -Action Backup` is the supported production-local entry point. It copies canonical bytes from the Compose `asset-data` volume into a private staging directory, invokes the verified PostgreSQL recovery operator, and publishes the manifest only after database and asset verification. The backup therefore covers both durable named volumes; caches and built images are reconstructable and are not backed up. The manifest contains no connection string, database password, service token, or original asset byte content.

`-Action Restore` accepts only a `pos_native_recovery_*` database, a backup UUID, and `-ConfirmRestore`. It restores into a new database and a distinct named asset volume, leaving the primary database and primary asset volume untouched. Recovery acceptance must start a separate loopback-only application against those targets and verify readiness, a representative M5 retrieval, and exact asset bytes before the backup is considered operationally proven.

## Current verified boundary

NativePOS has a versioned, local `pos-native-backup` directory format and a
synthetic fixture-backed proof service in `packages/backup`. On 2026-09-25, the
currently reachable PostgreSQL application state also passed a disposable
operator rehearsal with `pg_dump`/`pg_restore`, manifest verification, database
readback, and a loopback-only application restart. This is recovery evidence,
not a production backup service. A local Docker operator command now packages
that procedure with bounded output, manifest verification, no-overwrite backup
publication, and a mandatory clean-target check before restore.

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
createPostgresDatabaseBackup(backupRoot, driver, metadata, options);
restorePostgresDatabaseBackup(backupRoot, backupId, driver, options);
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

The filesystem restore result remains a clean copy proof containing an opaque
database-dump artifact. The PostgreSQL operator verifies that artifact, refuses
a target containing user schemas or objects, and only then sends the bytes to
`pg_restore --exit-on-error --single-transaction`. Docker-specific mechanics
remain outside the application runtime behind `DockerPostgresBackupDriver`.

Full-state backup reads the PostgreSQL asset receipt projection immediately
before and after `pg_dump`. It publishes nothing unless both projections agree
exactly. This brackets the dump against a concurrent asset commit that could
otherwise produce a manifest whose asset set differs from the database dump.

## Local PostgreSQL operator

Build before invoking the script, or use `npm run recovery:postgres -- ...`,
which builds first. The command uses `docker exec` with argument arrays and
`shell: false`. It does not accept a database URL or password and does not emit
PostgreSQL command errors, credentials, or dump bytes. The named container must
already provide local PostgreSQL authentication for the named synthetic role.

Backup into a new destination:

```powershell
npm run build
node scripts/postgres-recovery.mjs backup `
  --container <disposable-container> `
  --database <synthetic-source-database> `
  --user <synthetic-role> `
  --asset-root <source-asset-root> `
  --backup-root <private-new-backup-root> `
  --max-bytes 10485760 `
  --schema-version 0007 `
  --application-version 0.1.0
```

Verify without contacting PostgreSQL:

```powershell
node scripts/postgres-recovery.mjs verify `
  --backup-root <private-backup-root> `
  --backup-id <backup-uuid> `
  --max-bytes 10485760
```

Restore only after separately creating a fresh, empty target database:

```powershell
node scripts/postgres-recovery.mjs restore `
  --container <disposable-container> `
  --database <fresh-empty-target-database> `
  --user <synthetic-role> `
  --asset-root <fresh-empty-asset-root> `
  --backup-root <private-backup-root> `
  --backup-id <backup-uuid> `
  --max-bytes 10485760
```

The operator never creates, drops, empties, or overwrites a database. Its guard
rejects targets containing user relations, functions, composite types, domains,
enums, ranges, multiranges, or non-public user schemas before dump bytes are
supplied to `pg_restore`. Restore itself is one transaction, so a command error
cannot publish a partial PostgreSQL restore.

Application restore is deliberately not described as atomic across PostgreSQL
and the filesystem. It verifies the complete backup before target inspection,
requires both targets to be empty, stages only manifest-declared asset keys,
and compensates those staged keys if staging or PostgreSQL restore fails. After
PostgreSQL commits, it requires exact database receipt agreement and verifies
every restored file again. If either post-restore check fails, the command
reports failure and preserves both targets for investigation; it does not claim
rollback or delete files referenced by the restored database. Retry only with
new empty targets after the failed targets have been inspected and retained as
recovery evidence.

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

The disposable PostgreSQL container was then restarted and allowed to report
ready before a second readback. The same row counts remained, and a second
loopback-only application process accepted the same restored session and loaded
the restored workspace. Database-server and application-process restart
persistence were therefore exercised separately.

The exercise did not place credentials in the repository, did not contact
Notion, and did not modify a canonical or production database. It used a fresh
target and never overwrote a backup destination.

The packaged operator was separately accepted on 2026-09-25. It produced
backup `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb` (39,606 bytes, database SHA-256
`4e3c2329e1ac28fe139b3c6f9eaf3b7d32d25c31e04b855035538361974e6489`,
manifest SHA-256
`27480c44ac36dc3f1f6fa9bf8391f6281efe87124ee7cf77a241bfadd8935a49`).
All fifteen canonical tables present at the time had identical row counts and
deterministic row hashes after clean restore. A duplicate backup failed while leaving the
original manifest unchanged. A second restore into the populated target failed
while leaving its page count, audit hash, revision count, and session count
unchanged. Migrations remained compatible, the database container restarted,
and the loopback application accepted the restored session and retrieved the
restored page tree and structured record at property revision 3.

The schema now contains seventeen tables after search indexes and canonical
`page_links` were added. Whole-database `pg_dump`/`pg_restore` naturally covers
the new relationship, revision, and audit rows, but the fifteen-table rehearsal
above is historical evidence and is not the current-schema proof. The refreshed
seventeen-table rehearsal below supersedes it only for current-schema coverage;
the historical artifact remains useful evidence of the earlier boundary.

## 2026-09-27 full-state restore rehearsal

A PostgreSQL 18.6 container using disposable storage at
`/var/lib/postgresql` held separate synthetic source and destination
databases. The source included one asset receipt and byte artifact, two pages,
one data source, two data-source items and property values, revisions, and
audit events. The real operator created and verified backup
`346a6ebf-251e-4c75-9a9e-c7ff52e692f8` with manifest SHA-256
`1670c15538ba9f8cb49c3b986f205e1eeaaebd549738f53678d64eb39b061950`.

Restore into a fresh database and fresh asset root preserved exact row counts
and deterministic row hashes across all 15 canonical tables. The only restored
file was the manifest-declared 32-byte asset, whose source, manifest, database,
and restored-file SHA-256 all matched
`0f57dc9bbc7ed2a87a49e5a663cb1cb070465b92213453340975238d50d88025`.
Real CLI probes also refused a non-empty database, a non-empty asset root, and a
restore invocation missing `--asset-root`; the inspected targets and sentinel
file remained unchanged. All rehearsal data was synthetic and the disposable
resources were removed after validation.

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

1. An explicit encrypted/offline backup policy and a production operator
   rehearsal, including a decision about active session/token lifecycle.
2. Native `pg_dump`/`pg_restore` acceptance outside the disposable Docker
   boundary; this Windows host has no PostgreSQL client executables installed.
3. Linux deployment/permission acceptance and the later migration/cutover
   gates. Notion remains canonical throughout all of these steps.

The local operator does not handle production credentials or invoke a shell. A
backup is never accepted solely because creation returned successfully; the
verification and clean-restore gates must also pass.

## 2026-09-28 persistent full-state acceptance

PostgreSQL 18.6 was run with a disposable Docker named volume mounted at
`/var/lib/postgresql` (not the legacy `/var/lib/postgresql/data`). The real
production API created a synthetic 75-byte asset whose database receipt and
filesystem SHA-256 were
`41eb675cc9a9a9273b7d0bc36c510018c96723ea19a9b187d60615c4be06ccb6`.
Application-process restart and PostgreSQL-container restart independently
preserved authenticated list/download readback.

The real operator created and verified backup
`88888888-8888-4888-8888-888888888888`, with canonical manifest SHA-256
`6a16dfe8260462176cf9297d0190d52d4e5837af4e0fcce7392a8a93a8e1e780`.
Clean restore into a fresh PostgreSQL database and fresh asset root produced
matching counts and deterministic row hashes for all 15 canonical tables. The
manifest, restored database receipt, restored filesystem file, and authenticated
API download agreed on asset identity, 75-byte size, and SHA-256. Restored API
readback and browser-visible listing remained correct after separate application
and PostgreSQL restarts.

The rehearsal also proved that duplicate backup, non-empty database, non-empty
asset-root, and tampered-backup attempts fail without changing the inspected
accepted state. All inputs were synthetic. The containers, named volumes, and
workspace were removed after validation.

## 2026-09-28 independent review follow-up

Open Code Review delegation selected and the host reviewed all 16 reviewable
implementation files in `358b854..dec2634`. One High data-integrity finding was
confirmed: database dump creation and asset receipt collection used separate,
unbracketed PostgreSQL snapshots. A concurrent asset commit could therefore
publish a backup that would fail receipt agreement only after a future restore
had committed PostgreSQL. Backup creation now compares receipt projections on
both sides of `pg_dump` and refuses publication if they differ. A regression
test failed before the repair and passes afterward; the live PostgreSQL suite
passes 330/330 and a real stable-projection backup verifies successfully.

## 2026-09-28 current 17-table Navigation recovery acceptance

The reproducible opt-in current-schema rehearsal uses PostgreSQL 18.6 with a
disposable named volume mounted at `/var/lib/postgresql`. It applies migrations
through 0011, seeds two synthetic pages and searchable paragraph content, creates
and unlinks one page link, then relinks the same source/target pair with a new
UUID. The unchanged packaged recovery operator creates a custom-format
whole-database dump, publishes and reads the validated manifest, checks an empty
target, and restores with `pg_restore --exit-on-error --single-transaction`.

Before backup and after clean restore, the rehearsal compares row counts and
deterministic content hashes for all seventeen public canonical tables. It also
compares active forward links, active backlinks, full link history, all three
page-link revision snapshots, the `page.linked`, `page.unlinked`, and relink
`page.linked` audit events, and authenticated API search output. The archived
link retained UUID `44444444-4444-4444-8444-444444444444`; the active relink
retained distinct UUID `99999999-9999-4999-8999-999999999999`. Restored search
returned paragraph `recovery searchable paragraph` for page `Alpha Workspace`.

After a PostgreSQL-container restart, the target still reported seventeen
tables, the same active and archived link UUIDs, three page-link revisions,
three page-link audit events, and the searchable paragraph. All state was
synthetic. This acceptance does not prove production credentials, personal-data
recovery, Linux permissions, encrypted/offline policy, or Notion cutover.
