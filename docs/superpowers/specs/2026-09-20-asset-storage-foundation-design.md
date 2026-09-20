# Asset Storage Foundation Design

**Status:** Approved implementation scope — 2026-09-20

**Authority:** This is a focused technical design derived from the user-approved
`POS_Native_Codex_Master_Build_Prompt_v2_Product_First.md`. It implements the
next M1 dependency without reopening product discovery.

## Intent

Add a local, filesystem-backed asset-storage foundation that is safe to use as
the future backing store for NativePOS attachments and evidence. It must keep
file bytes separate from PostgreSQL metadata, be replaceable by a future local
S3-compatible adapter, and never use client-controlled filenames as paths.

This slice is deliberately not an upload UI or a migration feature. It makes
the lower storage boundary testable before any browser/API endpoint can expose
it.

## Scope and non-goals

This slice will add:

- a TypeScript `AssetStore` port and opaque storage-key contract;
- a filesystem implementation using only Node standard-library APIs;
- asset filename and MIME syntax validation at the storage boundary;
- configurable byte limits, SHA-256 receipts, bounded reads, and integrity
  verification;
- atomic file creation, containment checks, and safe rollback-only discard;
- deterministic isolated-directory tests for round trips, invalid input,
  limits, existing targets, cleanup, and symlink/path escape resistance;
- an ADR and operational boundary documentation.

It will not add:

- a public upload/download route, multipart parsing, a browser attachment UI,
  or any new runtime dependency;
- PostgreSQL asset metadata repository writes, asset audit/revision mutations,
  page-cover attachment, or user-facing asset deletion;
- external evidence upload, Google Drive/Box/Dropbox mirroring, S3 storage,
  Notion import, dual-write, migration, or cutover;
- a claim that a live PostgreSQL backup/restore rehearsal has passed.

The existing `assets` table remains the future canonical metadata store. The
new store produces validated byte receipts only; a later asset service will
persist them through the established domain/repository/audit boundary.

## Contract

`packages/assets/src/asset-storage.ts` will define the portable contract.

```ts
export type AssetStorageKey = string & { readonly __brand: "AssetStorageKey" };

export interface AssetStoreReceipt {
  readonly storageKey: AssetStorageKey;
  readonly byteSize: number;
  readonly sha256: string;
}

export interface AssetStageInput {
  readonly id: NativeId;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface StagedAsset extends AssetStoreReceipt {
  readonly id: NativeId;
  readonly originalFilename: string;
  readonly mimeType: string;
}

export interface AssetStore {
  stage(input: AssetStageInput): Promise<StagedAsset>;
  read(storageKey: AssetStorageKey): Promise<Uint8Array>;
  verify(receipt: AssetStoreReceipt): Promise<boolean>;
  discard(storageKey: AssetStorageKey): Promise<void>;
}
```

`storageKeyForAsset(id)` produces the only supported key form:
`asset-<native-uuid-v4>`. Every store operation validates that format at
runtime before resolving a path. The key has no user-controlled component and
is not a public URL or a filesystem path.

The staged filename is NFC-normalised metadata, never a path. Empty names,
control characters, NUL, `/`, and `\\` are rejected. MIME values are trimmed,
lower-cased media-type tokens; parameters, controls, and malformed values are
rejected. This is syntax validation, not content sniffing: future download
handling must remain attachment-safe and must not trust a MIME declaration for
active rendering.

## Filesystem implementation

`packages/assets/src/filesystem-asset-store.ts` will expose an async factory:

```ts
await FilesystemAssetStore.create(root, { maxBytes });
```

The factory creates the configured root if needed, canonicalises it with
`realpath`, and retains only that canonical root. `maxBytes` defaults to
50 MiB and must be a positive safe integer. Inputs above the limit fail before
a temporary file is opened. Reads use the same bound so an unexpected on-disk
file cannot cause an unbounded memory allocation.

`stage` creates `<root>/asset-<uuid>` through a unique sibling temporary file,
opens the temporary path with exclusive creation, writes and syncs the bytes,
then renames it into place. It refuses an existing target rather than
overwriting it. On any failed write it closes and removes only its own temporary
file before rethrowing. It returns a SHA-256 checksum calculated from the exact
input bytes and the byte count actually written.

`read`, `verify`, and `discard` resolve only validated keys beneath the
canonical root. They reject symbolic-link entries instead of following them.
`discard` is an internal compensation primitive for a failed later metadata
write, not a user-visible deletion API; it is idempotent for a missing regular
file and never follows links.

## Failure model

The filesystem and PostgreSQL cannot share one transaction. This foundation
therefore makes the file side explicit:

1. a future asset service creates a native ID and stages bytes;
2. it persists metadata, revision, and audit in one PostgreSQL transaction;
3. if that transaction fails, it calls `discard` for the fresh storage key;
4. if compensation fails, it must surface an orphan-cleanup error for an
   operator rather than silently declaring success.

The later service will own user-facing delete/retention semantics and audit
events. No client gains direct filesystem access in this slice.

## Security and portability

- The local root is user-controlled configuration; the application must never
  construct it from request input.
- Paths are derived only from a validated native storage key and checked for
  containment after resolution.
- User filenames, MIME declarations, and bytes are untrusted inputs.
- The store contains no telemetry, cloud dependency, shell execution, or
  provider-specific identity.
- A future S3-compatible local adapter implements the same `AssetStore` port;
  canonical metadata keeps the storage key and checksum independent of either
  adapter.

## Acceptance evidence for this slice

- exact bytes round-trip from an isolated temporary root;
- deterministic SHA-256 receipt and verification success/failure;
- rejection of invalid filename/MIME input, invalid storage keys, and files
  above the configured limit before persistent output is created;
- no overwrite of an existing key, no temporary-file residue after a failed
  write, and no traversal or symlink-following path;
- formatter, lint, strict typecheck, full test suite, fresh production build,
  dependency audit, and Git whitespace checks pass;
- status records this as synthetic filesystem coverage only. PostgreSQL
  metadata persistence, browser upload/download, backup/restore, and Notion
  migration stay explicitly unaccepted until their own gates pass.
