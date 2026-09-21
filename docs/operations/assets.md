# Asset Metadata Operations

## Current verified boundary

NativePOS has an internal, metadata-only asset creation service in
`packages/assets`. It is a tested foundation for a later authenticated upload
adapter, not a user-facing upload/download feature.

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

## Internal creation flow

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

## What is not an operation yet

Do not treat this service as permission to handle live personal files through a
browser or API. There is currently no public multipart route, download route,
content sniffing/quarantine policy, attachment browser UI, page-cover
assignment, metadata update/delete route, idempotency replay store, or startup
orphan reconciler. `discard` is compensation-only and is not a user deletion
feature.

Do not put asset roots, asset bytes, database dumps, `.env` files, or secrets
under source control. The current filesystem store is tested using isolated
temporary roots only.

## Required live acceptance gates

Before this boundary supports personal-file operations or is called durable,
complete and record all of the following:

1. Start an approved PostgreSQL environment; run migrations and the opt-in
   transaction/rollback tests, including restart readback.
2. Cross-check database metadata, revision/audit rows, and filesystem bytes in
   a real configured asset root.
3. Add an authenticated, CSRF-protected, bounded multipart upload and safe
   download/content policy through the service boundary.
4. Design and test reconciliation for retained compensation failures without
   broad or automatic deletion.
5. Include canonical asset metadata and bytes in a live backup/restore
   rehearsal, then prove retrieval after a clean restore.
6. Verify Linux ownership, permissions, crash recovery, and deployment
   operations on the intended home-server environment.

Notion remains canonical until the separate product, migration, retrieval, and
backup/restore gates have been passed and the user explicitly authorises
cutover.
