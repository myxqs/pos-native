# Canonical Data Model

M1 establishes explicit tables for users, sessions, API tokens, pages, blocks,
assets, revisions, audit events and idempotency records. Later milestones add
data sources, records, property definitions/values, relation edges and saved
views. All tables use POS Native UUID v4 identifiers and explicit foreign keys.

## Block documents

Each page owns one current block document. The canonical representation is a
flat set of relational block rows, with `parent_block_id` and server-owned
zero-based `position` values expressing the tree. NativePOS generates block
UUIDs; editor `clientRef` values are transient request-local references and
are never persisted as identity. Blocks omitted by a replacement are
soft-archived, not hard-deleted.

The document has its own `current_block_document_revision_number`, separate
from the page-title revision. Changed replacements atomically persist live
blocks, the page document revision, a recoverable `block-document` snapshot,
and an append-only `block-document.updated` audit event. The page's broad
`updated_at` advances with document changes. The first accepted block content
is a validated plain-text paragraph; editor-library JSON and HTML are not
canonical storage formats.

The future React editor adapter is TipTap/ProseMirror (ADR-0008), but the
native API and this relational contract remain the persistence boundary. The
current browser representation safely edits only an empty document or one
root paragraph and does not overwrite richer or nested documents.

`ExternalIdentity(native_entity_id, provider, external_id, metadata)` maps a
source provider's identifier to a native entity without replacing native
identity. Relations are relational edges, never strings containing links.
