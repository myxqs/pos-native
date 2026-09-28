# Canonical Data Model

M1 establishes explicit tables for users, sessions, API tokens, pages, blocks,
assets, revisions, audit events and idempotency records. Later milestones add
data sources, records, property definitions/values, relation edges and saved
views. All tables use POS Native UUID v4 identifiers and explicit foreign keys.

## Page hierarchy

A page has a stable native UUID independent of its title and position.
`parent_id` is a nullable foreign key: `null` identifies a root and any other
value is a relational parent edge, never a path. Pages may have at most thirty-
two parent edges (a root is depth zero); missing parents, cycles, and deeper
resulting hierarchies are rejected before page, revision, or audit writes.

The repository validates every page in the candidate graph after a hierarchy
mutation, not just the directly moved page. This prevents a valid-looking
subtree root from placing a live or archived descendant beyond the limit. Live
pages require live ancestors. Archived pages retain a structurally valid
ancestry so they can be inspected and restored safely; archive is allowed only
for a leaf with no live children, and restore requires an explicit live parent
or an explicit root destination.

Title, parent, and archive state share the page metadata revision stream.
Block-document content has its separate revision stream, so hierarchy changes
do not overwrite a page body and a body replacement does not change its parent
edge.

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

The page's archive state is also a persistence condition for a body replacement,
not merely an HTTP preflight. A write that races a committed page archive is
rejected before block, revision, or audit history changes; archived documents
remain readable. The PostgreSQL conditional update expresses this liveness
predicate atomically with the body revision compare-and-swap.

The future React editor adapter is TipTap/ProseMirror (ADR-0008), but the
native API and this relational contract remain the persistence boundary. The
current browser representation safely edits only an empty document or one
root paragraph and does not overwrite richer or nested documents.

## Page asset links

`page_asset_links` is the explicit recoverable relationship between a page and
an uploaded asset. Each relationship has its own native UUID, creation time,
nullable archive time, and creation provenance. Only one live relationship may
exist for a page/asset pair. Creation persists revision 1 and a
`page.asset-linked` audit event in one transaction.

Unlinking soft-archives the stable relationship ID, appends revision 2 and a
`page.asset-unlinked` audit event, and never deletes the asset. Normal reads
return live relationships; history reads include archived relationships. A
later relink creates a new stable relationship ID while retaining the archived
relationship and its evidence.

Because the relationship is canonical PostgreSQL state and asset bytes remain
in the bounded asset root, the existing full-state database-plus-asset backup
and restore path preserves both sides without a separate linkage artifact.

`ExternalIdentity(native_entity_id, provider, external_id, metadata)` maps a
source provider's identifier to a native entity without replacing native
identity. Relations are relational edges, never strings containing links.
