# ADR 0008: TipTap as the future block-editor adapter

## Status

Accepted for the future React workspace adapter — 2026-09-21.

The canonical block-document contract is implemented independently of this
decision. No editor dependency is installed by this ADR.

## Context

NativePOS needs a usable block editor, but the editor library must not become
the owner of canonical identity, persistence, revision history, auditability,
or migration semantics. The v2 product brief requires a self-hosted system
that remains portable if its UI is replaced.

The current M2 slice therefore establishes a native, relational block document
with server-generated UUIDs, same-page parent edges, stable sibling positions,
soft archival, and a separate optimistic-concurrency revision stream. Its
first accepted content is a plain-text `paragraph`; richer block kinds and a
React adapter are later extensions.

## Decision

Select TipTap/ProseMirror as the future React editor adapter. The choice is
based on the current official evidence checked on 2026-09-21:

- TipTap documents React integration and ProseMirror-based editor setup:
  <https://tiptap.dev/docs/editor/getting-started/install/react>.
- TipTap documents JSON persistence through an application backend:
  <https://tiptap.dev/docs/editor/core-concepts/persistence>.
- The current `@tiptap/react` manifest identifies version `3.30.3` and the MIT
  license:
  <https://github.com/ueberdosis/tiptap/blob/main/packages/react/package.json>.

The expected initial package set is the same-version public packages
`@tiptap/react`, `@tiptap/pm`, and `@tiptap/starter-kit`. Exact versions,
transitive dependencies, licenses, lockfile changes, bundle impact, and
security advisories must be inventoried and reviewed in the specific package
installation change. This ADR does not authorise installation or alter any
manifest.

BlockNote remains a possible future alternative, but is not the initial
production adapter. Its documentation confirms useful block IDs, recursive
children, and slash-menu support; its repository also records a mixed package
licensing boundary. No BlockNote `xl-*` package may be introduced under this
decision because those packages are GPL-3.0 or commercially licensed. A future
reversal to BlockNote requires a new ADR with a package-by-package license
decision and an explicit acceptance of the resulting dependency boundary.

## Adapter boundary

TipTap JSON is an interchange representation only. A mapper must translate it
to and from the NativePOS block contract. NativePOS owns:

- native block UUIDs; editor `clientRef` values are request-local only;
- page ownership and relational `parentBlockId` edges;
- deterministic sibling `position` values;
- validated discriminated block content;
- `current_block_document_revision_number` and `If-Match` concurrency;
- revision snapshots, append-only audit events, provenance, and soft archival.

The browser's current representation is intentionally narrower: it can edit an
empty document or one root paragraph, and must show a neutral unsupported-state
message for richer or nested content rather than replacing it. The future
TipTap adapter replaces that representation while retaining the same API,
native IDs, revision token, conflict handling, and URL contract.

## Consequences

Positive consequences:

- the UI can be replaced without rewriting canonical data;
- the system can add rich blocks incrementally through explicit schemas;
- backend persistence, audit, and migration tests do not require React or an
  editor runtime;
- no vendor-hosted service is required.

Costs and gates:

- NativePOS must implement its own mapper, slash-menu behavior, accessible
  interactions, drag/reorder semantics, and conflict/reload behavior;
- the later package change must pass exact lockfile/license/security review;
- TipTap selection does not claim support for the full required editor feature
  set until those behaviors are tested.

## Rollback and removal

Until the TipTap package change is made, rollback is simply to retain the
current safe paragraph adapter. After installation, removal is permitted only
after the adapter is disabled or replaced, all canonical data remains readable
through the native API, and a lockfile/build/test/license review proves no
runtime or schema dependency remains. Removing TipTap must never delete or
rewrite canonical blocks, revisions, audit history, or assets.
