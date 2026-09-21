# Editor and Canonical Block Document Core Implementation Plan

> For agentic workers: execute this plan one task at a time in the existing
> isolated worktree. Begin every behavior with a focused failing test, then make
> the smallest implementation, then run the stated verification. A skipped
> PostgreSQL suite or synthetic browser harness is not a live acceptance result.

**Goal:** Make page bodies durable canonical block documents with stable native
IDs, relational nesting, safe revision/audit history, optimistic concurrency,
and a visibly usable but deliberately narrow paragraph editor. The result must
remain independent of any future rich-editor library.

**Architecture:** A pure domain replacement function converts a bounded,
library-neutral document draft into a canonical block document and emits which
rows to upsert or soft-archive. A repository persists the page-level document
revision, live rows, document snapshot, and audit event atomically. The
versioned API supplies the authenticated/CSRF-protected read/write boundary.
The existing browser shell adds a safe single-root-paragraph adapter that
refuses to mutate documents it cannot represent. A later TipTap adapter changes
only browser representation, not canonical identity, storage, or API shape.

**Tech stack:** Existing strict TypeScript monorepo, Drizzle/PostgreSQL schema,
Fastify API, plain JavaScript web shell, Vitest 5, existing migration generator.
No package or service is installed in this slice.

**Design:** docs/superpowers/specs/2026-09-21-editor-and-block-document-design.md

## Global constraints

- Notion remains canonical. Do not import, dual-write, migrate, rehearse a
  migration, or cut over any live data.
- Do not install TipTap, React, BlockNote, Docker, a database server, a
  browser-driver, or any other package/service. The future editor decision is
  documented, not installed or claimed as completed UX.
- A client/editor cannot choose a native block identity. A client reference is
  request-scoped only and is never persisted.
- Persist canonical rows, not HTML or an editor-library document blob.
  Paragraph content is exactly an ordinary object with one text string.
- Each changed replacement needs one page-level document compare-and-swap,
  revision snapshot, audit event, block updates/archives, and broad page
  modified-time update in one transaction-shaped boundary.
- Omitted live blocks are soft-archived. No hard deletion/restoration, arbitrary
  block types, file embed, rich text, slash menu, drag/drop, undo/redo, or
  migration is added here.
- API actor identity is server-derived. A request body cannot choose actor,
  source, provenance, timestamps, positions, revision, or audit context.
- PostgreSQL integration tests remain opt-in under TEST_DATABASE_URL. Skips are
  visible gates, not proof of live durability.
- Title revision remains independent from body revision. Body writes use
  If-Match including quoted revision zero for an empty document.
- Browser edits can represent only an empty document or exactly one root
  paragraph. A richer document must be disabled with a neutral explanation
  rather than replaced.

## Review focus

- Domain validation must fail closed for identities, content, depth, sizes,
  client references, parent relationships, and forbidden arbitrary objects.
- Positions are server-derived by sibling draft order; semantic no-op writes
  make no history; omissions archive only after a valid changed replacement.
- Persistence must reject stale/cross-page/duplicate state without partial
  rows, revision, audit, or page metadata.
- Routes must distinguish missing page, malformed input, unauthenticated or
  CSRF-invalid mutation, and stale content.
- Browser behavior must never convert an unsupported document into a paragraph.
- Documentation must distinguish synthetic evidence from unproven live gates.

---

### Task 1: Record the editor adapter decision and update architecture

**Files:**

- Create: docs/adr/0008-tiptap-editor-adapter-selection.md
- Modify: docs/adr/0002-editor-and-persistence-selection-gate.md
- Modify: docs/architecture/data-model.md
- Modify: docs/architecture/pos-native-foundation.md

- [x] **Step 1: Define document acceptance assertions**

  Capture the primary evidence checked on 2026-09-21: TipTap React and
  persistence guides, its public React package manifest showing version 3.30.3
  and MIT, and BlockNote's MPL-2.0/GPL XL package boundary. Assert that
  TipTap/ProseMirror is a future adapter direction, not an installed dependency,
  and exact lockfile/license review plus a separate install approval are still
  required.

  Assert the updated architecture says a page has independent metadata and
  body-document revisions; blocks are native flat relational rows with optional
  same-page parents, server positions, archived state, and an evolvable content
  schema.

- [x] **Step 2: Demonstrate the pre-change documentation gap**

  Run:

      rg -n "TipTap|BlockNote|currentBlockDocument|archived_at|body revision" docs/adr docs/architecture

  Expected: ADR-0002 is still deferred and current architecture documents do
  not define this concrete body-document boundary.

- [x] **Step 3: Implement documentation only**

  Create accepted ADR-0008 that supersedes ADR-0002, documents the evidence,
  prohibits BlockNote XL packages, and records that no dependency changed.
  Document removal/rollback: canonical documents and APIs survive removal of
  any UI package.

  Update data-model and foundation documentation with the one-page/current
  document relationship, paragraph-first evolution, revision/audit snapshots,
  soft archive, and strict browser representability rule. Do not touch source or
  manifests in this task.

- [x] **Step 4: Format and inspect**

  Run:

  ```sh
  npm exec -- prettier --check docs/adr/0008-tiptap-editor-adapter-selection.md docs/adr/0002-editor-and-persistence-selection-gate.md docs/architecture/data-model.md docs/architecture/pos-native-foundation.md
  git diff --check
  ```

- [x] **Step 5: Commit**

  ```sh
  git add docs/adr/0008-tiptap-editor-adapter-selection.md docs/adr/0002-editor-and-persistence-selection-gate.md docs/architecture/data-model.md docs/architecture/pos-native-foundation.md
  git commit -m "docs: select editor adapter boundary"
  ```

### Task 2: Build a pure canonical block-document domain contract

**Files:**

- Create: packages/domain/src/block-document.ts
- Create: packages/domain/test/block-document.test.ts
- Modify: packages/domain/src/audit.ts
- Modify: packages/domain/src/index.ts

**Interfaces:**

The module exports paragraph-only block types, canonical live/archive block
values, a page document with separate revision number, request-scoped draft
client references, a replace command with derived audit context, explicit
upsert/archive mutation data, and a changed-or-unchanged replacement result.

- [x] **Step 1: Write deterministic failing domain tests**

  Use fixed UUID-v4 values and a fixed 2026-09-21 timestamp. Test:

  1. Empty revision-zero document becomes one paragraph with a server UUID,
     root parent, position zero, revision one, block-document revision snapshot,
     and block-document.updated audit event.
  2. Nested drafts resolve only through client references, preserve server-owned
     sibling order, and never persist a client reference.
  3. A supplied current ID is retained only when it is a live block in this
     exact page; unknown, archived, cross-page, and duplicate IDs reject.
  4. Omitted live blocks emit an archive instruction and remain recoverable in
     the before snapshot.
  5. An identical replacement at its current revision returns unchanged and
     creates no revision/audit mutation.
  6. Duplicate or malformed client references, unknown/self/cyclic parents,
     invalid IDs/revisions, wrong content keys/non-string text, per-block and
     total text limits, more than 1,000 blocks, and nesting depth over 32 throw
     ValidationError.
  7. Serialised revision/audit snapshots have no transient client references,
     prototype-bearing arbitrary data, or caller-controlled timestamps/positions.

  Expand the existing audit unions in imports so the RED state proves the
  intended type boundary rather than weakening TypeScript.

- [x] **Step 2: Observe RED**

      npm test -- packages/domain/test/block-document.test.ts

  Expected: module and typed audit literals are missing.

- [x] **Step 3: Implement minimal pure replacement**

  Require paragraph content to be an ordinary object with exactly text. Build
  every new block from injected newId and now dependencies. Resolve parents from
  client references before calculating depth. Derive zero-based sibling
  positions from draft order. Compare candidate and current live tree
  semantically without timestamps; return unchanged for a semantic no-op.

  For a changed request, emit explicit upserts and archive IDs plus revision
  number plus one and audit before/after snapshots. Store no client refs or
  arbitrary editor JSON. Extend audit entity/action unions precisely and
  re-export the contract.

- [x] **Step 4: Verify**

  ```sh
  npm test -- packages/domain/test/block-document.test.ts packages/domain/test/page.test.ts packages/domain/test/asset.test.ts
  npm run lint
  npm run typecheck
  ```

- [x] **Step 5: Commit**

  ```sh
  git add packages/domain/src/block-document.ts packages/domain/test/block-document.test.ts packages/domain/src/audit.ts packages/domain/src/index.ts
  git commit -m "feat: add block document domain contract"
  ```

### Task 3: Add schema invariants and atomic block-document repositories

**Files:**

- Modify: packages/database/src/schema.ts
- Create: packages/database/src/block-document-repository.ts
- Create: packages/database/src/postgres-block-document-repository.ts
- Create: packages/database/test/block-document-repository.test.ts
- Create: packages/database/test/postgres-block-document-repository.integration.test.ts
- Create: generated Drizzle migration/snapshot through npm run db:generate

**Interfaces:**

Define a repository that gets one page document or null and atomically replaces
a validated changed mutation. Export a typed document revision conflict error,
in-memory behavioral implementation with inspection/failure hooks, and a
PostgreSQL implementation.

- [x] **Step 1: Write failing repository tests**

  In memory, register a synthetic page and prove:

  - revision-zero reads, changed replace, row upserts/archives, page revision,
    history, and audit stay coherent;
  - stale revision throws typed conflict without mutation;
  - injected failures before rows, revision, or audit restore rows, page
    document revision/broad modified time, revision history, and audit;
  - archived rows disappear from current reads but retain identity/history;
  - cross-page parent/inconsistent mutation/duplicate sibling state rejects.

  In opt-in PostgreSQL integration cases, migrate/create a synthetic page and
  verify valid root/nesting plus rejected negative position, duplicate live
  sibling, and cross-page parent. Verify fresh readback, stale conflict, and
  forced late rollback. Use the established conditional skip if no
  TEST_DATABASE_URL; never invent a URL.

- [x] **Step 2: Observe RED**

      npm test -- packages/database/test/block-document-repository.test.ts packages/database/test/postgres-block-document-repository.integration.test.ts

- [x] **Step 3: Additive schema and generated migration**

  Add pages.current_block_document_revision_number as non-null integer default
  zero. Add blocks.archived_at, non-negative position check, normal unique
  target on id/page_id, composite parent/page foreign key, and a partial live
  sibling unique index over page ID, coalesced parent ID, and position.
  Archived rows cannot consume a live position.

  Generate instead of hand-maintaining Drizzle journal:

      npm run db:generate

  Inspect SQL before continuing. If the generator cannot express an invariant,
  document the exact limitation and choose only a migration-safe narrow
  alternative; do not silently weaken it.

- [x] **Step 4: Implement transaction boundaries**

  In memory snapshot every affected map/array/page metadata and restore it on
  injected failure. In PostgreSQL, read current page/body revision and current
  live document, compare-and-swap page body revision while advancing broad
  updated_at, then upsert/archive rows and insert one revision/audit event in
  one database transaction. Decode stored content through domain validation.
  API checks page existence first, but the repository must not fabricate a
  missing database page.

- [x] **Step 5: Verify**

  ```sh
  npm test -- packages/database/test/block-document-repository.test.ts packages/database/test/postgres-block-document-repository.integration.test.ts packages/database/test/page-repository.test.ts
  npm run lint
  npm run typecheck
  npm run db:generate
  git diff --check
  ```

- [x] **Step 6: Commit**

  ```sh
  git add packages/database/src/schema.ts packages/database/src/block-document-repository.ts packages/database/src/postgres-block-document-repository.ts packages/database/test/block-document-repository.test.ts packages/database/test/postgres-block-document-repository.integration.test.ts packages/database/drizzle
  git commit -m "feat: add block document repositories"
  ```

### Task 4: Expose authenticated page-body API and persistent runtime wiring

**Files:**

- Create: apps/api/src/block-document-routes.ts
- Create: apps/api/test/block-document-routes.test.ts
- Modify: apps/api/src/app.ts
- Modify: apps/api/src/runtime.ts
- Modify: relevant runtime/application tests and fakes

- [x] **Step 1: Write failing route/runtime tests**

  Test GET for an existing empty page, missing page, and authorisation. Test PUT
  requires existing mutation authorisation/CSRF and quoted numeric If-Match,
  accepts quoted zero for first write, and returns normalized current document.
  Test malformed headers, strict JSON unknown keys, unsafe IDs/content, and
  missing client references return 400; stale returns 409 unchanged; semantic
  no-op returns 200 without history growth. Assert request actor/source/audit
  fields cannot influence server-derived audit data. Update runtime fakes to
  expect PostgresBlockDocumentRepository beside current page persistence.

- [x] **Step 2: Observe RED**

      npm test -- apps/api/test/block-document-routes.test.ts

- [x] **Step 3: Implement strict adapter**

  Register GET and PUT at /api/v1/pages/:id/blocks. Reuse existing server
  authentication/authorisation/CSRF boundaries. Validate exact JSON and pass
  only page ID, parsed body If-Match, drafts, and server-derived audit context
  to the domain. Return an object containing the normalized document.

  Keep existing title If-Match parsing unchanged if it forbids zero. Add a
  narrowly named body parser that accepts zero. Map page absence to 404 and
  typed body conflict to 409. Do not add client idempotency replay, granular
  mutations, tokens, or public access.

- [x] **Step 4: Verify**

  ```sh
  npm test -- apps/api/test/block-document-routes.test.ts apps/api/test/app.test.ts apps/api/test/runtime.test.ts
  npm run lint
  npm run typecheck
  ```

- [x] **Step 5: Commit**

  ```sh
  git add apps/api/src/block-document-routes.ts apps/api/test/block-document-routes.test.ts apps/api/src/app.ts apps/api/src/runtime.ts apps/api/test
  git commit -m "feat: add page block document API"
  ```

### Task 5: Add the safe visible single-paragraph browser adapter

**Files:**

- Modify: apps/web/index.html
- Modify: apps/web/app.js
- Modify: apps/web/app.d.ts
- Modify: apps/web/styles.css
- Modify: apps/api/test/web-shell.test.ts

- [x] **Step 1: Write failing web-shell tests**

  Prove page selection loads title metadata and its GET blocks document. Empty
  documents enable body controls. A single root paragraph loads into a textarea,
  saves a retained server ID plus a request-local client reference, CSRF header,
  and quoted body revision. Prove blank existing versus empty document behavior,
  success refreshes body state, richer/nested/multiple blocks disable controls
  without a PUT, 409 retains text and tells user to reload, generic errors stay
  generic, and title save remains on title revision.

- [x] **Step 2: Observe RED**

      npm test -- apps/api/test/web-shell.test.ts

- [x] **Step 3: Implement the narrow adapter**

  Add accessible labeled body controls. On selection fetch document after page
  metadata and use a generation token so late responses cannot alter a new
  selection. Represent only zero blocks or exactly one root paragraph with
  text. For anything else, disable mutation and display neutral explanation.

  For a representable document, build one contract draft directly and PUT body
  If-Match plus current CSRF. Retain existing server ID only for the one
  supported paragraph. Make body save distinct from title save. Never use
  innerHTML for page/error data or add a custom rich-text parser.

- [x] **Step 4: Verify**

  ```sh
  npm test -- apps/api/test/web-shell.test.ts apps/api/test/block-document-routes.test.ts
  npm run lint
  npm run typecheck
  ```

- [x] **Step 5: Commit**

  ```sh
  git add apps/web/index.html apps/web/app.js apps/web/app.d.ts apps/web/styles.css apps/api/test/web-shell.test.ts
  git commit -m "feat: add safe paragraph block editor"
  ```

### Task 6: Truthful handover, full verification, independent review, and integration

**Files:**

- Modify: STATUS.md
- Modify: CHANGELOG.md
- Modify: this plan
- Modify: .superpowers/sdd/editor-and-block-document-core/progress.md (ignored)

- [x] **Step 1: Update evidence-bound documentation**

  Check plan boxes only after their stated evidence. Update status/changelog
  with canonical document/revision/audit/API/browser behavior. Explicitly retain
  live PostgreSQL, real browser, configured owner/authentication, Docker,
  backup/restore, rich editor, migration, and Notion-cutover gates.

- [x] **Step 2: Run full verification**

  ```sh
  npm run verify
  npm run db:generate
  npm run build -- --listEmittedFiles
  npm audit --omit=dev --json
  git diff --check
  git status --short
  ```

  Expected: lint/typecheck/tests/build/schema generation green; live suites
  visibly skipped without TEST_DATABASE_URL; production audit clean.

- [x] **Step 3: Independent review and repair**

  Ask a fresh reviewer to inspect this exact branch/worktree against design and
  plan. It must separate Critical/Important/Minor defects from intentional
  gates. Fix every valid finding through a focused regression test before
  re-running relevant verification.

- [x] **Step 4: Commit evidence and integrate**

  ```sh
  git add STATUS.md CHANGELOG.md docs/superpowers/plans/2026-09-21-editor-and-block-document-core.md
  git commit -m "docs: record block document verification"
  git status --short
  git log --oneline main..HEAD
  ```

  Fast-forward only after branch cleanliness and passed stated synthetic gates.
  Preserve the branch/worktree recovery point; do not delete worktrees.

## Deferred work

- Separately authorised TipTap install with exact package/license inventory,
  rich block adapter, slash commands, keyboard/paste/IME/undo/redo,
  drag/reorder, accessibility, and touch/mobile proof.
- Structured databases/views, hierarchy UX, assets-in-blocks, links/backlinks,
  search/graph, exports, MCP, Local Steward retrieval.
- Live PostgreSQL migration/transaction/restart proof, full backup/restore,
  owner/session runtime, browser acceptance, deployment/Tailscale, Notion
  migration rehearsal, and explicit cutover approval.
