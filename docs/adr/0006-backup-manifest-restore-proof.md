# ADR 0006: Versioned directory backup manifest and clean-restore proof

## Status

Accepted — 2026-09-21.

## Context

NativePOS must provide a user-controlled, verifiable backup and restore path
covering canonical PostgreSQL state, filesystem asset bytes, configuration
metadata, and integrity checks. Docker/PostgreSQL is not currently available on
the development host, so a `pg_dump`/`pg_restore` implementation cannot be
tested truthfully. A successful file-copy command is not a restore acceptance
result, and an archive format would introduce extraction/path risks before the
core integrity contract is established.

## Decision

Introduce `packages/backup` with a versioned `pos-native-backup` format-v1
manifest and a directory-backed filesystem proof service. A backup directory
uses a generated native ID and only fixed artifacts:

```text
backup-<native-uuid>/
  database/canonical.dump
  assets/asset-<native-uuid>
  manifest.json
```

The manifest records format/version, source schema/application/adapter metadata,
an opaque database-dump receipt, sorted asset receipts, and a SHA-256 checksum
over a canonical fixed-key-order manifest core. It rejects unsupported shapes,
unknown keys, unsafe paths, duplicate identities, malformed receipt values, and
checksum mismatch.

`BackupSource` is an injected port. It supplies opaque database-dump bytes and
database-authoritative asset receipts; the first implementation is exercised
only with synthetic fixtures. Filesystem create, list, verify, and restore use
canonicalised configured roots, bounded reads, regular-file/no-symlink checks,
exclusive output, manifest-last publication, and `targetRoot/backup-<id>`
no-overwrite refusal. Restore verifies source artifacts before it creates the
new child directory, then verifies the persisted result.

## Consequences

- The backup format is local, inspectable, provider-independent, and separate
  from future portable open export or archive transport.
- User filenames, connection strings, raw credentials, tokens, and artifact
  bytes do not appear in the manifest or normal operation messages.
- A future PostgreSQL adapter can implement `BackupSource` without weakening
  manifest/path/integrity semantics.
- This decision does not claim `pg_dump`, `pg_restore`, a clean PostgreSQL
  restore, database/asset transactional consistency, restart readback,
  production backup encryption, or an operational restore rehearsal.
- The production policy for restored sessions/tokens remains a security gate;
  it must not be inferred from the synthetic fixture proof.
