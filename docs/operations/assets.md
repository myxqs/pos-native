# Asset Operations

## Current verified boundary

NativePOS has an authenticated, CSRF-protected asset vertical built on the
asset creation service in `packages/assets`. The browser and API accept bounded
`application/octet-stream` uploads, list canonical metadata, and download
verified bytes from the configured local filesystem asset root.

The service receives a `Uint8Array`, a filename, MIME type, actor, and bounded
provenance context. It owns a byte snapshot before asynchronous work begins,
then stages the snapshot using the existing filesystem `AssetStore`. The
canonical record is persisted only after the stage receipt and independently
verified stored bytes match that snapshot's byte size and SHA-256 checksum.

The canonical asset record contains a generated native UUID, opaque
`asset-<uuid>` storage key, normalised filename/MIME metadata, byte size,
SHA-256, timestamp, and bounded provenance. Creation adds immutable revision
1 and an `asset.created` audit event. These snapshots contain metadata only;
they do not contain file bytes, connection strings, passwords, or tokens.

## Creation flow

```text
caller input
  -> service-owned byte snapshot
  -> validated filesystem stage under expected opaque key
  -> receipt vs snapshot checksum/size comparison
  -> store receipt verification
  -> one metadata/revision/audit repository transaction
```

The repository port has an in-memory implementation for deterministic tests and
a PostgreSQL adapter that uses one transaction for the `assets`, `revisions`,
and `audit_events` inserts. PostgreSQL tests are explicitly skipped unless a
separate `TEST_DATABASE_URL` is available.

The repository contract is all-or-nothing: a rejected `create` must not leave
the supplied asset metadata, revision, or audit event observable. The
in-memory adapter has injected rollback tests, and the guarded PostgreSQL suite
forces a later revision conflict to prove transaction rollback once a test
database is available. A new adapter must supply equivalent failure evidence;
filesystem compensation cannot repair a partial metadata commit.

## Failure and reconciliation boundary

Filesystem staging and SQL persistence are not one atomic operation. If a
successful stage is followed by any receipt, verification, or repository
failure, the service requests rollback-only `discard` for its own generated
opaque key. It never deletes a key returned by an invalid or untrusted receipt.

If cleanup also fails, the service raises `AssetCompensationError`. The error
contains the original and cleanup causes plus the expected opaque storage key;
normal error messages deliberately omit filenames and bytes. That condition is
not a successful write. It must be retained for a future authenticated
reconciliation workflow that checks the opaque key against canonical metadata
before any operator-approved repair.

`AssetStorageIntegrityError` means that a receipt did not verify against the
service-owned bytes or the storage adapter reported failed verification. It
also prevents metadata persistence and enters the same expected-key cleanup
path after staging.

## Current limitations

The current upload route accepts raw bounded bytes rather than multipart form
data. There is no content sniffing or malware quarantine, inline rendering,
page attachment/cover assignment, metadata update/delete route, idempotency
replay store, or startup orphan reconciler. `discard` is compensation-only and
is not a user deletion feature. These limits mean that synthetic acceptance is
not permission to import personal files or cut over from Notion.

Do not put asset roots, asset bytes, database dumps, `.env` files, or secrets
under source control. Acceptance uses only isolated disposable roots and
synthetic bytes.

## 2026-09-28 disposable acceptance

Using PostgreSQL 18.6 with its disposable named volume mounted at
`/var/lib/postgresql`, the production loopback runtime accepted a synthetic
75-byte asset. Its PostgreSQL receipt, revision, audit event, filesystem byte
count, and SHA-256 agreed. API readback survived a separate application restart
and PostgreSQL-container restart.

The real recovery operator then created and verified a full-state backup,
restored it into a completely fresh database and empty asset root, and matched
all 15 canonical table counts and deterministic row hashes present at that
historical asset-acceptance checkpoint. The restored
asset's database receipt, manifest, filesystem bytes, API download, byte size,
and SHA-256 agreed before and after separate application and PostgreSQL
restarts. The authenticated browser displayed the asset from both source and
restored state.

The ChatGPT Chrome extension could not automate the native file chooser because
file-URL access is unavailable. Browser-driven upload and programmatic capture
of the browser blob download therefore remain automation acceptance limits;
no browser permissions were weakened. Authenticated API upload/download byte
equality and browser-visible authenticated listing are verified product
evidence, but are not represented as a passed browser file-chooser test.

A later current-schema Navigation rehearsal separately matched counts and
deterministic hashes across all seventeen tables, including page links,
revisions, and audit events. It used an empty asset set and therefore extends
database recovery evidence without replacing the 75-byte asset round-trip
evidence above.

## Remaining live acceptance gates

Before this boundary supports personal-file operations, complete and record:

1. Design and test reconciliation for retained compensation failures without
   broad or automatic deletion.
2. Verify Linux ownership, permissions, crash recovery, and deployment
   operations on the intended home-server environment.
3. Complete a human-operated browser file-chooser and download acceptance check
   without changing browser security permissions.

Notion remains canonical until the separate product, migration, retrieval, and
backup/restore gates have been passed and the user explicitly authorises
cutover.
