# Asset Metadata Service and Repository Design

**Status:** Approved implementation scope — 2026-09-21

**Authority:** This focused design implements the next M1 dependency from the
user-approved v2 product brief. It follows the completed filesystem asset-store
foundation and does not reopen product discovery, expose an upload endpoint, or
touch Notion.

## Intent

Make an asset a canonical NativePOS entity rather than a filesystem receipt
alone. The new application service will combine a safely staged byte receipt
with immutable PostgreSQL metadata, an asset creation revision, and an
append-oriented audit event. It will make the unavoidable filesystem/database
transaction gap explicit and safe to operate.

The service is internal. It is the future boundary used by authenticated API,
browser, importer, and MCP adapters; those adapters are not added in this
slice. User-supplied bytes and metadata remain untrusted and no raw bytes enter
the canonical database, revision snapshot, audit snapshot, status, or error
messages.

## Existing foundations

- `packages/assets` owns an `AssetStore` port. Its filesystem adapter stages
  bytes below a configured canonical root under a generated opaque key,
  calculates SHA-256/size receipts, refuses overwrite and links, and supports
  rollback-only `discard`.
- The existing `assets` table already contains native ID, filename, MIME type,
  size, SHA-256, opaque storage key, creation timestamp, and string provenance.
- `revisions` and `audit_events` are generic PostgreSQL tables, while the
  current TypeScript domain types are page-specific. This slice generalises the
  TypeScript contract for page and asset entities without changing stored table
  layout.
- Page repositories establish the required one-transaction metadata,
  revision, and audit persistence pattern. In-memory repositories provide the
  synthetic atomic-rollback seam.

## Scope

This slice will add:

- a domain-owned asset metadata model, opaque key validation, safe metadata and
  provenance normalisation, asset creation mutation, revision, and audit
  envelope;
- a generalized typed audit/revision contract for the existing page and new
  asset entity types;
- an `AssetMetadataRepository` port, atomic in-memory implementation, and
  PostgreSQL implementation using the existing `assets`, `revisions`, and
  `audit_events` tables in one transaction;
- an internal `AssetService.create` orchestration boundary which owns byte
  snapshotting, staging, receipt verification, canonical persistence, and
  compensating rollback;
- deterministic synthetic and opt-in PostgreSQL tests, an ADR, operations
  documentation, and truthful status evidence.

This slice will not add:

- a public upload/download HTTP route, multipart parser, browser attachment
  control, page-cover mutation, asset deletion/retention API, import pipeline,
  S3 adapter, cloud storage, or Notion migration/cutover;
- a live PostgreSQL claim, Docker command, credential, shell wrapper, or owner
  bootstrap;
- an idempotency replay implementation. No asset mutation endpoint is exposed
  in this slice. When an endpoint is added, its idempotency record must be
  claimed, persisted with the canonical mutation, and completed/replayed with
  defined failed-claim recovery; the current generic helper is insufficient to
  establish that transactional boundary by itself.

## Canonical model and validation

`packages/domain/src/asset.ts` becomes the canonical source for the identity
and metadata shape used by storage, repositories, and future callers.

```ts
type AssetStorageKey = string & { readonly __brand: "AssetStorageKey" };

interface Asset {
  readonly id: NativeId;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly storageKey: AssetStorageKey;
  readonly createdAt: string;
  readonly provenance: Readonly<Record<string, string>>;
}
```

`storageKeyForAsset(id)` is exactly `asset-<native-uuid-v4>` and
`asAssetStorageKey` refuses any other spelling. The filename is NFC-normalised
metadata, never a path; empty names, path separators, controls, and names over
255 characters are rejected. MIME syntax is a lower-cased media type token and
is not content safety evidence. Sizes must be non-negative safe integers and
checksums must be lowercase 64-character SHA-256 hex.

The initial provenance input has an explicit bounded shape:

```ts
{
  source: string;
  actorId: string;
  requestId?: NativeId;
  runId?: string;
}
```

It is converted to a string-only map containing `source` and `actorId`, plus
the optional provided identifiers. This preserves the existing SQL JSON shape
without accepting a free-form opaque blob that could inadvertently carry
secrets. Audit context contains actor type, source, optional request ID,
optional human-readable reason, and `runId` as non-secret audit metadata.

An asset creation is prepared before staging so the native ID and timestamp are
owned by the domain. Once the store returns a receipt, the domain completes a
`CreateAssetMutation`. The mutation contains:

- the canonical `Asset` record;
- revision `1` with `entityType: "asset"` and a metadata-only snapshot;
- audit action `asset.created`, `before: null`, and the same metadata-only
  `after` snapshot.

The receipt must name the prepared asset's exact opaque key, match its native
ID, have a bounded size and valid checksum, and have exactly the prepared
normalised filename/MIME metadata. No revision or audit snapshot has a `bytes`
field.

## Repository transaction

`AssetMetadataRepository.create(mutation)` is the canonical persistence port.
The PostgreSQL adapter performs the following in one Drizzle transaction:

1. insert the `assets` row;
2. insert revision `1` into `revisions`;
3. append the asset audit row to `audit_events` including optional audit
   context fields.

The current schema needs no migration for immutable creation: generic revisions
already key `(entity_type, entity_id, revision_number)`, and `assets` already
has a unique storage key. A later mutable asset-metadata feature must make an
explicit current-revision policy decision rather than silently assuming the
asset table has a page-style current-revision column.

The in-memory adapter uses snapshot rollback and injectable failures before the
revision/audit writes. It proves that no partial metadata, revision, or audit
state remains after a failed mutation. Both adapters reject duplicate native
identity or storage key and never overwrite an existing record.

## Application-service failure model

The filesystem and PostgreSQL cannot form one shared transaction. The service
uses this bounded sequence:

1. validate input and copy the supplied `Uint8Array` before the first async
   boundary;
2. prepare the native asset identity and metadata;
3. stage byte snapshot through `AssetStore` using that identity;
4. validate the returned receipt against the prepared identity/metadata and
   byte snapshot; verify it through the store;
5. construct and persist the metadata/revision/audit mutation;
6. return the persisted canonical asset only after step 5 commits.

If staging itself fails, the service does not persist metadata and does not
attempt to guess a path to delete; a compliant store must clean its own failed
stage. If anything after a successful stage fails, the service calls
`discard` only for the generated expected storage key. It never follows a
malformed/untrusted receipt key into deletion. If discard succeeds, the
original failure is rethrown. If discard fails, the service raises a typed
`AssetCompensationError` containing both failures and the opaque expected key;
this is an operator-visible orphan/reconciliation condition, never success.

The service validates and verifies before SQL persistence, but a catastrophic
filesystem loss after verification/SQL commit remains an operational
cross-resource integrity risk. Future startup reconciliation and live failure
testing are required; this slice does not claim to solve a process crash between
those systems.

## Security, privacy, and portability

- Storage keys and native IDs are generated by NativePOS; filenames, MIME
  declarations, and external IDs never determine a storage path or canonical
  identity.
- Metadata validation is defence in depth; future download routes must still
  treat client MIME as untrusted and choose safe attachment/content headers.
- Filesystem storage stays behind the existing portable port, so a local
  S3-compatible adapter can replace it without changing canonical metadata.
- Raw bytes, database URLs, passwords, tokens, and full personal filenames do
  not appear in error messages, audit metadata, status, or test output.
- `discard` is compensation only. It is not a user deletion operation and does
  not weaken future retention/audit requirements.

## Verification and acceptance boundary

Synthetic tests must prove domain validation, metadata-only revision/audit
snapshots, in-memory atomic rollback, staged receipt identity matching,
verification before persistence, successful compensation, failed compensation,
and no mutation after stage validation failure. PostgreSQL integration tests
remain conditionally skipped without `TEST_DATABASE_URL`; when live they must
prove migrations, transaction rollback on a forced later write conflict,
unique constraints, revision/audit readback, restart persistence, and metadata
versus filesystem receipt cross-integrity.

No test in this slice is evidence of a live upload/download flow, Docker
runtime, PostgreSQL durability, browser usability, backup/restore rehearsal,
Linux deployment, Notion import, or canonical cutover.
