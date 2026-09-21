# ADR 0007: Canonical asset metadata after verified byte staging

## Status

Accepted — 2026-09-21.

## Context

NativePOS needs a canonical asset record whose identity, filename metadata,
integrity receipt, provenance, revision, and audit history are independently
recoverable from filesystem bytes. The filesystem `AssetStore` can safely stage
an opaque native-keyed byte snapshot, but a filesystem write and a PostgreSQL
transaction cannot share one atomic commit. Treating a successful write as a
complete canonical asset would leave untraceable metadata or orphaned bytes on
a later failure.

The `assets`, `revisions`, and `audit_events` tables already exist, while the
development host has no available PostgreSQL runtime. The implementation must
therefore establish a testable domain and repository boundary without claiming
live database durability or an upload feature.

## Decision

Asset identity and storage-key rules live in the domain contract. Every new
asset receives a native UUID and an exact opaque `asset-<uuid>` storage key;
user filenames and external identifiers are metadata only. The service copies
the caller's bytes before asynchronous staging, generates a metadata-only
asset/revision/audit mutation, and requires all of the following before it
persists canonical metadata:

1. The stage receipt exactly matches the generated native identity, opaque key,
   normalised filename, and MIME type.
2. The receipt byte count and SHA-256 match the service-owned byte snapshot.
3. The storage adapter independently verifies the staged receipt.
4. The repository commits the asset row, immutable revision 1, and
   `asset.created` audit event in one transaction.

If staging has succeeded but receipt validation, integrity verification, or
canonical persistence fails, the service calls `discard` only for the expected
generated storage key. It never trusts or deletes a key supplied by a malformed
receipt. If both the original operation and compensation fail, it raises an
`AssetCompensationError` carrying the expected opaque key and both causes for a
future reconciliation workflow.

The PostgreSQL adapter has one transaction for asset metadata, revision, and
audit persistence. The in-memory adapter provides equivalent rollback-shaped
test behaviour. Generic audit/revision contracts support page and asset
entities while keeping the asset snapshot metadata-only.

`AssetMetadataRepository.create` is explicitly an all-or-nothing contract: if
it rejects, none of the supplied asset, revision, or audit event may be
observable. Filesystem compensation cannot repair a partial metadata commit, so
every future adapter must provide a local transaction or equivalent rollback
boundary and prove it with implementation-specific failure tests.

## Consequences

- Asset metadata has a native identity, bounded provenance, immutable creation
  revision, and attributable audit record without placing raw bytes in a
  canonical snapshot.
- The filesystem/SQL boundary is explicit compensation, not distributed
  atomicity. A failed compensation remains an operator-visible orphan condition
  rather than a silent success or a broad delete.
- No HTTP multipart endpoint, download endpoint, browser attachment control,
  page-cover operation, idempotency replay, mutable metadata, user deletion,
  or startup reconciliation is enabled by this decision.
- PostgreSQL integration tests remain opt-in. This ADR does not claim a live
  transaction, restart persistence, database/filesystem cross-integrity,
  backup linkage, Linux permissions, or production recovery acceptance.
- A future authenticated API must use this same domain/service boundary and add
  request idempotency and reconciliation deliberately; it must not write asset
  rows or filesystem paths directly.
