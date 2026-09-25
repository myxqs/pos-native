# Authenticated Asset Vertical and Recovery Design

**Status:** Approved design scope — 2026-09-25

**Authority:** This design implements the next dependency-ordered NativePOS
product slice after the verified PostgreSQL recovery operator. It reuses the
existing asset domain, filesystem store, metadata service, PostgreSQL adapter,
session/CSRF boundary, browser shell, and backup manifest. It does not authorise
live personal files, Notion access, public exposure, software installation, or
deployment.

## Intent

Make the existing asset foundation reachable through the real loopback-only
application and recoverable as one database/filesystem state. A signed-in local
user must be able to upload a bounded synthetic file, see deterministic
metadata, download bytes only after integrity verification, restart the
application and database, back up both stores, restore them into fresh targets,
and retrieve the same verified bytes.

This is a deliberately narrow attachment surface. It does not add page covers,
inline embeds, previews, rich-editor integration, deletion, replacement,
sharing, content indexing, antivirus claims, or cloud storage.

## Existing foundations

- `AssetService` owns validation, service-side byte snapshotting, native UUID
  generation, staging, receipt verification, metadata/revision/audit
  persistence, and expected-key-only compensation.
- `FilesystemAssetStore` uses opaque `asset-<uuid>` keys, canonical-root
  containment, bounded regular-file reads, no-overwrite publication, SHA-256
  receipts, and symlink refusal.
- `PostgresAssetMetadataRepository` atomically persists the asset record,
  revision 1, and `asset.created` audit event and can retrieve or list metadata.
- Authenticated API routes already derive human actor identity from the
  server-side session and require double-submit CSRF proof for mutations.
- The browser already has a safe authenticated workspace shell and renders
  untrusted values through DOM text properties.
- The backup format already describes database and asset artifacts with fixed
  paths, sizes, checksums, manifest checksums, bounded reads, and no-overwrite
  publication.

## Runtime composition

Production runtime configuration adds:

- `POS_ASSET_ROOT`: required canonical local filesystem root;
- `POS_MAX_ASSET_BYTES`: optional positive safe integer, defaulting to the
  existing 50 MiB asset limit.

The runtime constructs one `FilesystemAssetStore`, one
`PostgresAssetMetadataRepository`, and one `AssetService` using the existing
Drizzle connection. Failure to validate or create the configured root aborts
startup and closes persistence. The root is never served as a static directory.

Runtime persistence exposes the asset metadata repository so authenticated
reads use the same PostgreSQL pool and close boundary. Test composition may
inject the asset service, store, and repository explicitly.

## HTTP contract

All routes are versioned below `/api/v1/assets`, require the existing cookie
session, and return fixed safe errors. Database errors, paths, checksums,
command output, and internal exception messages are never returned.

### Upload

`POST /api/v1/assets` accepts only `application/octet-stream` with a strict
route body limit. It requires:

- the existing CSRF header/cookie proof;
- `X-NativePOS-Filename`, containing `encodeURIComponent(file.name)` rather
  than raw header text;
- `X-NativePOS-Media-Type`, containing the declared MIME type or
  `application/octet-stream` when the browser supplies none.

The route strictly percent-decodes the filename once, rejects malformed
encoding, arrays, duplicates, controls, separators, and oversized metadata,
and passes an owned `Uint8Array` to `AssetService`. Actor type and actor ID come
only from the authenticated server session; the request cannot supply them.
Creation provenance is `source: "nativepos.browser"` with the server request ID.
Success is `201` with metadata only. Empty files remain valid if the existing
domain byte-size policy permits them. Oversized bodies fail before storage or
database mutation.

The raw-byte protocol avoids a new multipart dependency and keeps parser
limits explicit. It is an internal NativePOS API, not a public generic upload
protocol.

### List

`GET /api/v1/assets?limit=<n>` returns metadata ordered by creation timestamp
and UUID. The default is 50 and the maximum is 100. The repository contract is
changed to accept a validated limit so PostgreSQL applies the bound rather than
reading all rows and slicing in application memory.

### Download

`GET /api/v1/assets/:id/content` loads canonical metadata, reads only its opaque
storage key, and verifies size and SHA-256 before returning bytes. A missing
metadata row is `404`; missing, changed, oversized, non-regular, or mismatched
bytes are a fixed `409 asset integrity check failed`. The response uses:

- `Content-Type: application/octet-stream` regardless of the declared MIME;
- `X-Content-Type-Options: nosniff`;
- `Content-Disposition: attachment; filename="asset-<uuid>"` using only the
  server-generated ID;
- an exact content length.

The authenticated metadata list contains the normalised original filename and
declared MIME type. The browser may use that filename for a local download
attribute, but it is never reflected into an HTTP header or filesystem path.

## Browser surface

The private workspace adds one compact Assets section containing:

- a native file input and Upload button;
- a deterministic metadata list showing filename, declared type, and size;
- a Download button per asset;
- fixed status messages for authentication, validation, integrity, conflict,
  and network failures.

Upload reads the selected `File` as an `ArrayBuffer`, sends raw bytes with the
CSRF proof and encoded metadata headers, then refreshes the bounded list.
Download fetches authenticated bytes, creates a temporary object URL, triggers
a download using the metadata filename, and always revokes the URL. It does not
render or preview untrusted content. Pending/generation guards prevent late
list or upload responses from replacing newer state. Controls remain keyboard
operable and usable at the existing narrow viewport breakpoint.

## Asset-aware backup and restore

Database-only backup remains available only when explicitly named as such in
code. The operator's normal backup command adds required `--asset-root` input
for an application-state backup.

The Docker PostgreSQL adapter reads the canonical asset receipt projection
(`id`, opaque storage key, byte size, SHA-256) using a fixed `psql` query with
unaligned machine output. Strict parsing rejects extra fields, malformed UUIDs,
keys, sizes, checksums, duplicates, and unbounded output. The configured
filesystem store reads and verifies every receipt before the existing backup
publisher writes database and asset artifacts. A missing or mismatched byte
aborts publication and removes only the newly created backup directory.

Restore requires both a fresh empty PostgreSQL database and a fresh empty asset
root. The complete backup is verified before either target is changed. Asset
files are staged under their manifest-derived native IDs with no overwrite,
then PostgreSQL is restored in one transaction. If database restore fails, the
operator compensates only the asset keys staged by that attempt. Cleanup
failure is reported as an explicit incomplete-recovery condition, never
success. After database restore, the operator queries restored metadata and
requires an exact identity/size/checksum match with the manifest, then verifies
every stored byte again.

The operator never creates, drops, truncates, empties, or overwrites a database
or asset root. It does not delete pre-existing files. Backup and restore paths,
asset bytes, credentials, and command errors are not printed.

## Security and failure behavior

- Authentication is required for list, upload, and download; CSRF is required
  for upload.
- Browser identity, actor fields, storage keys, checksums, and canonical IDs are
  never accepted as upload inputs.
- Filename and MIME type are metadata, not trusted content classification.
- Downloads are forced attachments with `nosniff`; no inline rendering or
  executable interpretation is introduced.
- Body, metadata, list, command-output, artifact, and stored-read bounds are
  explicit and fail closed.
- Storage/database compensation retains the existing expected-key-only rule.
- There is no user-facing delete operation. Recovery cleanup only addresses
  keys created by the failed restore attempt.
- The API remains loopback-only by default and does not create public routes,
  tokens, shares, telemetry, or external calls.
- Notion and live personal data remain outside the slice.

## Testing and acceptance

TDD proceeds through these independently verifiable units:

1. bounded repository listing and metadata lookup behavior;
2. authenticated upload route, raw parser, CSRF, server actor, fixed errors,
   and oversized/malformed input rejection;
3. authenticated list and integrity-gated download routes;
4. runtime asset-root composition and failure cleanup;
5. browser upload/list/download controller behavior, late responses, safe text,
   and object-URL cleanup;
6. asset-aware backup source parsing, byte verification, clean restore,
   compensation, no-overwrite behavior, and post-restore cross-integrity.

Focused tests must be watched failing before implementation. Checkpoint
verification includes formatting, lint, strict typecheck, complete non-live
tests, production build, dependency audit, schema drift check, and the complete
live PostgreSQL suite.

Live synthetic acceptance must prove:

- owner-authenticated browser upload and download of known bytes;
- metadata, revision, audit, and filesystem receipt agreement;
- logout/revocation and CSRF refusal on asset routes;
- process and PostgreSQL restart retrieval;
- database plus asset backup creation and manifest verification;
- duplicate destination, tamper, non-empty database, and non-empty asset-root
  refusal without changing accepted targets;
- clean restore with exact UUID, metadata, revision, audit, relation/page state,
  asset receipt, and byte equivalence;
- retrieval of the restored bytes through the restarted production runtime.

Skipped integration tests remain unverified, not passed. Linux permissions,
malware scanning, production encryption/offline storage, mobile hardware,
public deployment, live Notion migration, and personal-file acceptance remain
explicit later gates.

## Scope boundary

This design ends when a synthetic authenticated user can upload, list, download,
restart, back up, clean-restore, and re-download verified local bytes. It does
not add page attachment references, page covers, rich-editor embeds, file
replacement, deletion, previews, search indexing, OCR, remote object storage,
Notion import, or migration. Those require later dependency-ordered designs.
