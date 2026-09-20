# ADR 0005: Filesystem asset storage behind a portable port

## Status

Accepted — 2026-09-20.

## Context

NativePOS requires user-controlled local files, checksums, safe filename
handling, and a future path to S3-compatible local storage. The canonical
PostgreSQL `assets` table already records metadata, but no byte-storage
implementation exists. The product must not depend on a cloud provider or let
an upload request choose an arbitrary filesystem path.

## Decision

Introduce a small `AssetStore` port in `packages/assets`. Its initial
`FilesystemAssetStore` implementation stores bytes under a configured,
canonicalised local root using generated keys of the form `asset-<native-uuid>`.
It stages byte receipts (key, byte size, SHA-256), validates filename/MIME
metadata syntax, applies a configurable bounded size limit, writes atomically,
and rejects traversal and symbolic-link targets.

The store is not a public HTTP endpoint and does not itself persist canonical
metadata. A later asset service will combine a staged receipt with the existing
`assets` table and the normal audit/revision transaction, compensating with the
store's internal `discard` operation if metadata persistence fails.

## Consequences

- No user filename or external-provider ID becomes a local path or canonical
  storage identity.
- Future local S3-compatible storage can implement the same port without
  changing metadata contracts.
- The filesystem/SQL transaction gap is explicit and must be handled by the
  later service; this ADR does not pretend an atomic cross-resource write
  exists.
- Asset upload/download UI, multipart parsing, external evidence references,
  backup/restore, and migration remain later milestones with separate tests.
