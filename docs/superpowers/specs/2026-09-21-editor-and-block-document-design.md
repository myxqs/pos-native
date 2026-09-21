# Editor Foundation and Canonical Block Document Design

## Purpose and approval boundary

This is the next product-first NativePOS slice. It turns an existing page from
a title-only record into a canonical, revisioned block document without letting
an editor library own identity or persistence. The user-approved v2 master
brief and the standing instruction to continue autonomously approve this
architecture and implementation planning. Notion remains untouched and
canonical; no import, dual-write, migration rehearsal, or cutover is in scope.

The slice is deliberately smaller than the finished editor: it establishes a
usable paragraph-block body, safe nested-document semantics, and an adapter
boundary that later supports the required rich block types. It does not install
a new package, expose personal data, or claim a live PostgreSQL/browser result.

## Current evidence and editor decision

The following primary sources were checked on 2026-09-21:

- Tiptap's React guide documents its React bindings, ProseMirror dependency,
  starter kit, editor context, menus, and client-side rendering guidance:
  <https://tiptap.dev/docs/editor/getting-started/install/react>.
- Tiptap's persistence guide supports JSON interchange through a backend API:
  <https://tiptap.dev/docs/editor/core-concepts/persistence>.
- The current `@tiptap/react` package manifest records version `3.30.3` and
  the MIT license:
  <https://github.com/ueberdosis/tiptap/blob/main/packages/react/package.json>.
- BlockNote documents block IDs, recursive child blocks, and block-oriented
  content:
  <https://www.blocknotejs.org/docs/foundations/document-structure>.
- BlockNote documents a ready-made configurable slash menu:
  <https://www.blocknotejs.org/docs/react/components/suggestion-menus>.
- BlockNote's repository states that most packages are MPL-2.0 and `xl-*`
  packages are GPL-3.0 or commercially licensed:
  <https://github.com/TypeCellOS/BlockNote>.

### Decision

Select TipTap/ProseMirror as the future React editor adapter. Its MIT React
package, explicit JSON interchange, extensible schema, and lack of a required
vendor-hosted runtime are a better long-term fit for a private self-hosted
system whose canonical model must remain independent of the UI library.

The expected initial packages are same-version public packages
`@tiptap/react`, `@tiptap/pm`, and `@tiptap/starter-kit`, pinned only after an
exact lockfile and per-package license inventory is reviewed. TipTap itself
will need a NativePOS-owned slash menu, drag/reorder behavior, accessibility
work, and a mapper; those are implementation work, not capabilities claimed
merely by selection.

BlockNote remains a viable future alternative for a proof where its ready-made
block UX materially outweighs its package-license boundary. It is not selected
for NativePOS's initial production adapter. No BlockNote XL package is
permitted by this decision.

The local operating charter requires explicit authority before installing
software. Therefore this slice makes no dependency change. A later, specific
package-install operation is a genuine gate; all canonical backend work below
is deliberately independent of it.

ADR-0008 will supersede proposed ADR-0002 with this evidence and preserve the
package-install and adapter-acceptance gates.

## Canonical block-document contract

### Ownership and identity

- A page owns one current block document, represented canonically as flat
  relational block rows plus an ordered document snapshot history.
- NativePOS generates every new block UUID. An editor-generated identifier is
  a transient client reference only and can never become a canonical block ID.
- `parentBlockId` is a relational edge inside the same page. The database stores
  a flat model; a mapper may present it as a nested editor tree.
- User filenames, HTML, a TipTap document blob, and editor-library JSON are not
  canonical block identity or storage format.

### First supported content

The first persisted block kind is `paragraph`. Its canonical content is exactly
an object with one `text` string; it is plain text, not HTML. Empty text is
valid. A document can be empty. Paragraph blocks may be nested so tree and
ordering rules are proven before richer UI behavior arrives.

The first contract rejects all other kinds rather than accepting opaque or
editor-specific JSON. Subsequent slices extend the discriminated content schema
for headings, lists, todos, quote/callout/code/divider/toggle, assets, links,
tables, child pages, and saved views. This avoids silently storing unsupported
editor data while preserving an explicit evolution path.

Limits are part of validation: at most 1,000 live blocks per document; each
client reference is 1–128 ASCII identifier characters; paragraph text is at
most 20,000 Unicode code units; maximum nesting depth is 32; and the serialised
paragraph-text total is at most 250,000 code units. No input can request a
filesystem path, execute code, or supply arbitrary object/prototype data.

### Replace-document request and result

The initial write operation replaces the current live document atomically:

```ts
type BlockDraft = {
  clientRef: string;
  id?: NativeId;
  parentClientRef?: string;
  blockType: "paragraph";
  content: { text: string };
};

type ReplaceBlockDocumentCommand = {
  pageId: NativeId;
  expectedRevisionNumber: number;
  blocks: readonly BlockDraft[];
  actorType: AuditActorType;
  actorId: string;
  source: string;
  requestId?: NativeId;
  reason?: string;
};
```

`clientRef` exists only for one request: it links parent/child drafts and lets a
future editor reconcile server-generated IDs. It is never stored. A supplied
`id` is accepted only when it is an existing live block ID in this exact page;
unknown, archived, duplicate, or cross-page IDs fail closed. A missing `id`
means the server obtains a new native UUID. Parents are named with
`parentClientRef`, not an editor/library ID. The input's sibling order defines
server-owned zero-based `position` values.

The result returns the complete normalised canonical document, including native
IDs and stable sibling positions. The operation rejects duplicate client refs,
unknown parents, self-parents, cycles, excessive depth, invalid content, and
duplicate existing IDs. An identical document at the expected revision is a
no-op: it returns the existing document without another audit/revision entry.

Blocks omitted from a changed document are soft-archived in the same mutation;
they are never hard-deleted by this slice. Their prior document revision/audit
snapshot remains recoverable. Restore UX is a later, explicit operation.

### Revision, audit, and concurrency

Document revisioning is independent from the existing page-title revision
stream. Add `pages.current_block_document_revision_number`, initially zero.
Each changed replacement increments it and creates:

- a generic `revisions` entry with `entityType: "block-document"`, the page ID
  as `entityId`, and a metadata/content-only `BlockDocument` snapshot; and
- an append-oriented `audit_events` entry with action
  `block-document.updated`, target type `block-document`, the user/API actor,
  source, optional request/reason, and before/after document snapshots.

The page's broad `updated_at` is advanced with a changed document so normal
page listings retain a useful last-modified timestamp. Its existing page-title
revision remains metadata-specific; the document's separate revision is the
authoritative optimistic-concurrency token for body changes.

`If-Match` carries the expected document revision for the first HTTP write. A
retry after a committed request cannot create a second revision because it sees
a stale revision and returns 409; a semantic no-op at the current revision
returns unchanged state. General idempotency-record replay remains a later
cross-cutting API hardening task and must be designed consistently for all
mutating routes rather than bolted onto this one route.

### Persistence invariants

Additive migration only:

- `pages.current_block_document_revision_number integer NOT NULL DEFAULT 0`;
- `blocks.archived_at timestamptz NULL`;
- a live-sibling unique index on `(page_id, COALESCE(parent_block_id,
'00000000-0000-0000-0000-000000000000'::uuid), position)` filtered to
  `archived_at IS NULL`;
- a non-negative `position` check; and
- a `UNIQUE (id, page_id)` constraint plus a composite
  `FOREIGN KEY (parent_block_id, page_id) REFERENCES blocks(id, page_id)` so a
  non-null parent must belong to the same page. The existing parent-ID foreign
  key remains and the domain still validates cycles and depth.

The PostgreSQL repository performs page-version compare-and-swap, block
insert/update/archive, document revision insert, and audit insert in one local
transaction. If it rejects, no part of that document mutation is observable.
The in-memory repository provides the same atomic rollback-shaped behavior for
deterministic tests. Live PostgreSQL tests remain opt-in under
`TEST_DATABASE_URL`; skipped tests are not durability evidence.

## API and first visible adapter

Add authenticated routes beneath the existing versioned API boundary:

```text
GET /api/v1/pages/:id/blocks
PUT /api/v1/pages/:id/blocks  (CSRF proof + If-Match document revision)
```

The GET response returns the current document, including revision number. PUT
strictly validates the JSON request and returns 400 for invalid input, 404 for
a missing page, and 409 for a stale document revision. Authorisation and audit
actor identity come from the existing server-derived route boundary; request
body actor fields are never trusted.

The initial browser adaptation is intentionally a single-root-paragraph editor
behind the same API. It is not a custom rich-text engine: it proves load,
create/update, save, reload, generic failure text, and stale-save recovery
using the canonical contract. It can edit only an empty document or exactly one
root paragraph; it disables content mutation and displays a neutral message for
any richer/nested document so it can never silently replace unsupported blocks.
A later TipTap adapter replaces only this browser representation, maps its
tree/inline JSON through the contract, and retains all native IDs/revisions/URLs.

## Explicit non-goals and gates

This design does not add TipTap or React packages, rich-text marks, slash menu,
keyboard shortcut suite, drag/drop, undo/redo, paste conversion, assets,
embeds, page links, database views, full block-type support, page move/delete,
search, MCP, exports, Notion migration, or cutover. It does not create an
owner, credentials, PostgreSQL database, public listener, or browser
acceptance claim.

The later TipTap proof must pin exact versions and licenses, use only
NativePOS-owned canonical IDs, test keyboard/screen-reader/touch/IME/paste
behavior, prove slash/reorder/nesting behavior, prove conflict/reload recovery,
and add no collaboration/SaaS service by default.

## Acceptance evidence for this slice

Synthetic tests must demonstrate stable native IDs, no client-created canonical
IDs, deterministic nested order, no-op detection, soft archive on removal,
cycle/page/limit rejection, revision/audit snapshots, rollback before revision
and audit, stale-write rejection, and route authentication/CSRF/input handling.
PostgreSQL tests must be visibly skipped without a test URL and later prove the
migration, uniqueness/index constraints, transaction rollback, and restart
readback. Full repository formatting, lint, strict typecheck, tests, schema
generation, build, production dependency audit, and an independent review are
required before integration.
