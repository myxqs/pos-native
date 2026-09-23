# Page Hierarchy, Archive, and Navigation Design

## Purpose and approved scope

This product-first slice makes the existing `pages.parent_id` relation a
canonical NativePOS capability. It delivers nested page creation, safe
reparenting, leaf-only soft archive, explicit restore, a hierarchy-aware
sidebar, and breadcrumbs while retaining stable native UUIDs and existing
metadata/body revision boundaries.

The user-approved master brief already requires hierarchical pages, nested
pages, breadcrumbs, move/reparenting, and safe archive/restore. The standing
instruction to continue autonomously approves this implementation slice. Notion
remains untouched and canonical; no importer, dual-write, migration rehearsal,
or cutover is involved.

## Canonical model and invariants

`Page` gains `parentId: NativeId | null`. It is a relational edge, never a
path-derived identity. Existing `archivedAt`, title, timestamps, provenance,
page metadata revisions, revision snapshots, and audit events remain part of
the canonical page state.

The root is depth `0`. The hierarchy permits at most `32` parent edges from a
page to its root (therefore at most `33` nodes in a root-to-leaf path); an
attempt to create or move a page to depth `33` is rejected. Every page
mutation is validated against the current canonical graph with these rules:

- a non-null parent exists, is live, and has a valid native ID;
- a page cannot parent itself, one of its descendants, or a malformed/cyclic
  ancestor chain;
- a move changes only the moved page's `parentId`; page and block UUIDs remain
  stable;
- a live page can be archived only when it has no live direct children;
  NativePOS never silently cascades archive, reparenting, or deletion;
- archived pages cannot receive children or move; restoring requires an
  explicit live parent or root (`null`), rejects an archived parent, and never
  implicitly restores archived descendants;
- archive and restore preserve blocks, assets, prior revisions, and audit
  history; neither operation hard-deletes anything;
- all title, move, archive, and restore changes advance the existing page
  metadata revision and produce one page revision plus one append-oriented
  audit event.

The leaf-only archive policy deliberately prevents a live child from becoming
invisible beneath an archived ancestor. To archive a subtree, the user must
first archive or move its children explicitly. This is conservative and
recoverable while a richer tree-management UX is still deferred.

## Domain and persistence boundary

The domain exports separate `movePage`, `archivePage`, and `restorePage`
commands alongside the existing title update command. Their audit actions are
`page.moved`, `page.archived`, and `page.restored`; each before/after snapshot
includes `parentId` and `archivedAt`. The repository contract represents title
update, move, archive, and restore as a discriminated `PageUpdateMutation`
union, so each operation persists its own typed revision and audit envelope
through the existing single mutation boundary.

`PageRepository` owns graph validation because a pure command cannot know
whether an indicated parent exists, is live, or would complete a cycle. The
in-memory repository validates a candidate graph before its existing
rollback-shaped persistence boundary. The PostgreSQL repository takes a
transaction-scoped advisory hierarchy lock, reads the required current page
state, validates the candidate graph, then performs the existing target-page
revision compare-and-swap, revision insert, and audit insert in that same
transaction. The lock is intentionally global for this single-user product:
it prevents two valid-looking concurrent moves from forming a cycle between
separate rows.

PostgreSQL already has a nullable self-foreign-key and parent index. No new
schema representation or parallel hierarchy table is added. The existing
self-foreign-key prevents dangling stored parents; repository validation adds
archive, depth, and cycle policy.

`list` receives an explicit archive scope. Normal navigation reads only live
pages; archived-page listing is a separate, deliberate request for restore UX.
The browser refreshes the active list normally and requests
`?archived=only` only when the user opens the archive section. An archived
selection remains addressable by its stable ID for read/history/restore after
it disappears from active navigation. Archived pages are rejected by ordinary
title/body/move mutations until restored.

## HTTP API

All routes remain beneath `/api/v1/pages`, use the existing shared authorizer,
derive actor/source only from that authorizer, and require CSRF proof for every
cookie-backed mutation.

```text
POST /api/v1/pages
  { title, parentId?: UUID | null }       -> 201 current page + revision

GET /api/v1/pages                         -> active pages only
GET /api/v1/pages?archived=only           -> archived pages only

PUT /api/v1/pages/:id/parent
  If-Match: <page metadata revision>
  { parentId: UUID | null }                -> 200 current page + revision

POST /api/v1/pages/:id/archive
  If-Match: <page metadata revision>
  {}                                       -> 200 current page + revision

PUT /api/v1/pages/:id/restore
  If-Match: <page metadata revision>
  { parentId: UUID | null }                -> 200 current page + revision
```

All bodies are strict. Invalid IDs, invalid archive scope, unknown keys,
parent absence, archive-policy violations, and malformed state return fixed
400 responses. Missing pages return 404. Stale revisions, attempts to mutate
an archived page through a non-restore route, and archive/restore state races
return fixed 409 responses without leaking storage details. The title route
continues to use its existing unquoted positive `If-Match` contract; body
revision behavior stays separate and unchanged.

## Browser behavior

The browser receives two safe flat page lists: active navigation pages and an
explicit archived list. It validates each flat list before rendering a nested
`ul` tree, rejects duplicate/missing/cyclic/deeper-than-32 parent structures,
and uses `textContent` for every server title. It does not recursively render
unvalidated server input.

For a selected live page, the UI offers:

- create child page;
- a parent selector with root and valid non-descendant active pages;
- explicit save-move and archive controls; and
- a breadcrumb assembled from the validated flat hierarchy.

For an archived page, ordinary title/body/move/create-child controls are
disabled. The UI presents an explicit parent selector and restore control.
Body content stays readable but cannot be mutated until restore succeeds.
All hierarchy requests use the existing metadata revision, CSRF proof,
same-origin credentials, fixed generic error text, and selection/refresh
generation guards so a late list or page response cannot overwrite a newer
selection or draft.

Drag-and-drop, bulk moves, recursively archiving subtrees, icons/covers,
rich editor installation, links/backlinks, structured databases, and Notion
migration remain separate work.

## Acceptance evidence

Synthetic tests must prove root/child creation, persisted parent identity,
safe move, self/direct/indirect cycle rejection, an allowed 32-edge chain and
rejected 33-edge chain, archived-parent rejection, leaf-only archive, explicit
restore, revision/audit snapshots, rollback, stale same-target concurrent
mutation conflicts, normal/archived list scopes, strict API boundaries, and
hierarchy-aware browser rendering/race behavior. The in-memory suite proves
same-target compare-and-swap behavior; PostgreSQL's advisory-lock integration
suite separately proves cross-page hierarchy serialization.

Opt-in PostgreSQL tests must separately cover hierarchy persistence and
transactional validation when `TEST_DATABASE_URL` is available. A skipped
suite, synthetic browser harness, absent owner account, and unavailable Docker
engine are visible gates rather than live acceptance evidence.
