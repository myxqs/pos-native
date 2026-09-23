# Page Hierarchy, Archive, and Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development or superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Make NativePOS pages safely nestable, movable, archivable, restorable,
and navigable through a responsive hierarchy-aware browser shell.

**Architecture:** Extend the existing canonical `Page` and `pages.parent_id`
relationship rather than adding a parallel tree. Repository-owned graph
validation and metadata revision compare-and-swap protect every hierarchy
mutation; the browser consumes validated flat page lists and renders a nested
tree plus breadcrumb controls.

**Tech Stack:** Existing strict TypeScript monorepo, Fastify, Drizzle/PostgreSQL,
plain JavaScript browser shell, Vitest 5. No package or service is installed.

**Spec:** `docs/superpowers/specs/2026-09-21-page-hierarchy-design.md`

## Global Constraints

- Notion remains canonical; do not import, dual-write, migrate, rehearse a
  migration, or cut over any real data.
- Preserve native page and block UUIDs; parents are relational edges, not paths.
- Treat root as depth 0; allow at most 32 parent edges (33 nodes) and reject a
  33-edge chain. Fail closed on missing, archived, cyclic, or malformed
  ancestry.
- Archive only a leaf with no live children; no implicit cascade, reparent, or
  hard delete.
- Use existing page metadata revisions and CSRF/auth boundaries for moves,
  archives, and restores. Body revisions remain independent.
- Keep normal navigation and mutations to live pages; expose archived records
  only through deliberate read/restore paths.
- PostgreSQL integration tests stay opt-in under `TEST_DATABASE_URL`; no skipped
  test or synthetic browser result is a live acceptance claim.
- Do not install TipTap/React, Docker, browser automation, or any other package.

## Review Focus

- Concurrent cross-page moves must not create a cycle after individually valid
  stale checks; PostgreSQL must serialize hierarchy validation and CAS. The
  in-memory suite proves same-target revision conflicts; the opt-in PostgreSQL
  suite is the evidence for cross-page serialization.
- An archive must not hide live descendants or silently affect page blocks,
  assets, IDs, or unrelated revisions.
- A malformed/cyclic server list must not recurse indefinitely or become a
  navigation write target in the browser.
- Client request bodies must not supply actor/source/provenance/revision or
  bypass CSRF through a hierarchy endpoint.
- A late list/page/mutation response must not replace a newer selected page or
  re-enable controls for an archived page.

---

### Task 1: Extend the page domain state and mutation contracts

**Files:**

- Modify: `packages/domain/src/page.ts`
- Modify: `packages/domain/src/audit.ts`
- Modify: `packages/domain/test/page.test.ts`
- Modify: `packages/domain/src/index.ts` if the new commands need re-exporting

**Interfaces:**

- `Page` gains `parentId: NativeId | null`.
- `createPage` accepts an already parsed `parentId` defaulting to `null`.
- `movePage`, `archivePage`, and `restorePage` each return a typed page
  revision/audit mutation with actions `page.moved`, `page.archived`, and
  `page.restored`.
- `PageUpdateMutation` is a discriminated union of title, move, archive, and
  restore mutations; `PageRepository.update` accepts that union and persists
  its matching revision/audit envelope atomically.

- [x] **Step 1: Write deterministic failing domain tests**

  Add fixed-UUID tests proving a root has `parentId: null`, a child preserves a
  supplied parent ID, a move preserves page identity and changes only parent
  state, archive/restore preserve body-independent metadata, and all new
  before/after snapshots contain parent/archive state. Add invalid command
  tests for malformed parent IDs, move/archive of an already archived page,
  restore of a live page, and invalid metadata revision.

- [x] **Step 2: Observe RED**

  Run:

  ```sh
  npm test -- packages/domain/test/page.test.ts
  ```

  Expected: new hierarchy commands/types do not exist or snapshots lack
  `parentId`.

- [x] **Step 3: Implement minimal immutable commands**

  Parse only native IDs and metadata-local state in the domain. Leave
  graph-wide parent existence/cycle/child checks to the repository. Use injected
  IDs/time, preserve creation time/identity, set `archivedAt` only in archive,
  and emit one revision/audit envelope for each changed command.

- [x] **Step 4: Verify and commit**

  ```sh
  npm test -- packages/domain/test/page.test.ts packages/domain/test/block-document.test.ts
  npm run lint
  npm run typecheck
  git add packages/domain/src/page.ts packages/domain/src/audit.ts packages/domain/src/index.ts packages/domain/test/page.test.ts
  git commit -m "feat: add page hierarchy domain commands"
  ```

### Task 2: Make hierarchy persistence atomic and graph-safe

**Files:**

- Modify: `packages/database/src/page-repository.ts`
- Modify: `packages/database/src/postgres-page-repository.ts`
- Modify: `packages/database/test/page-repository.test.ts`
- Modify: `packages/database/test/postgres-page-repository.integration.test.ts`
- Modify: `packages/database/test/schema.test.ts` only if current schema
  assertions need the already-present parent relation clarified

**Interfaces:**

- `PageRepository.list(scope?: "active" | "archived")` filters normal versus
  recovery navigation deterministically.
- `PageHierarchyError` distinguishes invariant rejection from a stale
  `PageRevisionConflictError`.
- `update` validates a full candidate graph before writing page/revision/audit.

- [x] **Step 1: Write failing in-memory and opt-in PostgreSQL tests**

  Prove root/child persistence and filtering; reject missing/archived parents,
  self-parent, direct/indirect cycles, repeated/corrupt ancestor chains, an
  allowed 32-edge chain, and a rejected 33-edge chain. Prove moving a child
  updates one page revision/audit; archiving a
  leaf succeeds; archiving a live parent fails; restoring requires a live target
  parent. Use failure hooks to show no partial page/revision/audit state.
  Add opt-in PostgreSQL cases for parent mapping, stale move CAS, and rollback
  after hierarchy validation.

- [x] **Step 2: Observe RED**

  ```sh
  npm test -- packages/database/test/page-repository.test.ts packages/database/test/postgres-page-repository.integration.test.ts
  ```

  Expected: parent values are discarded and graph invariants are unenforced.

- [x] **Step 3: Implement repository-owned validation**

  Map `parentId` in both directions. In memory, build a candidate map before
  the existing rollback-shaped write. In PostgreSQL, take a transaction-scoped
  advisory hierarchy lock, read enough page state to validate the candidate,
  then retain the existing target-page revision CAS and revision/audit insert
  in that transaction. Do not add a duplicate hierarchy table or alter the
  existing self-foreign-key migration.

- [x] **Step 4: Verify and commit**

  ```sh
  npm test -- packages/database/test/page-repository.test.ts packages/database/test/postgres-page-repository.integration.test.ts packages/database/test/block-document-repository.test.ts
  npm run lint
  npm run typecheck
  npm run db:generate
  git diff --check
  git add packages/database/src/page-repository.ts packages/database/src/postgres-page-repository.ts packages/database/test/page-repository.test.ts packages/database/test/postgres-page-repository.integration.test.ts packages/database/test/schema.test.ts
  git commit -m "feat: persist safe page hierarchy"
  ```

### Task 3: Add strict hierarchy HTTP routes and archive policy

**Files:**

- Modify: `apps/api/src/page-routes.ts`
- Modify: `apps/api/test/page-routes.test.ts`
- Modify: `apps/api/test/app.test.ts` only if route registration expectations
  change

**Interfaces:**

- Create accepts strict `{ title, parentId? }`.
- `PUT /api/v1/pages/:id/parent`, `POST /api/v1/pages/:id/archive`, and
  `PUT /api/v1/pages/:id/restore` use a current page metadata `If-Match`.
- List accepts only no archive query or `?archived=only`.

- [x] **Step 1: Write failing route tests**

  Cover nested create/list/read, active versus archived list scopes, move,
  archive/restore, malformed/unknown payload fields, missing/archived parents,
  auth/CSRF, stale competing moves, and body-supplied actor/provenance fields.
  Assert fixed 400/404/409 response contracts and no extra history after a
  rejected request.

- [x] **Step 2: Observe RED**

  ```sh
  npm test -- apps/api/test/page-routes.test.ts
  ```

  Expected: hierarchy routes are missing and create rejects `parentId`.

- [x] **Step 3: Implement narrow API adapters**

  Parse native IDs with Zod, call only server-derived domain commands, map typed
  hierarchy and archived-state errors to fixed responses, and preserve the
  existing title route behavior. Reject ordinary title/body mutation of an
  archived page; do not relax the block-document route's authorizer.

- [x] **Step 4: Verify and commit**

  ```sh
  npm test -- apps/api/test/page-routes.test.ts apps/api/test/block-document-routes.test.ts apps/api/test/app.test.ts
  npm run lint
  npm run typecheck
  git add apps/api/src/page-routes.ts apps/api/test/page-routes.test.ts apps/api/test/app.test.ts apps/api/src/block-document-routes.ts apps/api/test/block-document-routes.test.ts
  git commit -m "feat: add page hierarchy API"
  ```

### Task 4: Render and operate the safe browser page tree

**Files:**

- Modify: `apps/web/index.html`
- Modify: `apps/web/app.js`
- Modify: `apps/web/app.d.ts`
- Modify: `apps/web/styles.css`
- Modify: `apps/api/test/web-shell.test.ts`

**Interfaces:**

- Browser request helpers fetch the active list during ordinary refresh and
  the archived list only after the user opens the explicit archive section;
  both scopes create/move/archive/restore pages with existing credentials,
  CSRF, and page revisions. An archived selection remains stable-ID addressable
  for restore after it is removed from active navigation.
- `pageTreeFromPages` returns a validated nested hierarchy and bounded
  breadcrumbs; invalid server hierarchy throws a generic availability error.

- [x] **Step 1: Write failing browser-shell tests**

  Test nested active-page rendering, child creation, breadcrumb output, valid
  parent selection/move, archive removing a page from active navigation,
  archived restore (including rejected archived-parent restore), disabled
  archived edits, 409 draft preservation, generic
  failures, and late active/archived list responses after a newer refresh or
  selection.

- [x] **Step 2: Observe RED**

  ```sh
  npm test -- apps/api/test/web-shell.test.ts
  ```

  Expected: hierarchy controls/tree/breadcrumb helpers do not exist.

- [x] **Step 3: Implement the narrow responsive UX**

  Add labelled controls for child creation, parent selection/save, archive,
  restore, active nested lists, archived list, and breadcrumbs. Render only
  validated trees using DOM nodes and `textContent`; use generation tokens and
  disable relevant controls while requests are pending. Preserve the distinct
  body revision editor semantics introduced in M2.

- [x] **Step 4: Verify and commit**

  ```sh
  npm test -- apps/api/test/web-shell.test.ts apps/api/test/page-routes.test.ts
  npm run lint
  npm run typecheck
  npm exec -- prettier --check apps/web/index.html apps/web/app.js apps/web/app.d.ts apps/web/styles.css apps/api/test/web-shell.test.ts
  git diff --check
  git add apps/web/index.html apps/web/app.js apps/web/app.d.ts apps/web/styles.css apps/api/test/web-shell.test.ts
  git commit -m "feat: add page hierarchy browser UX"
  ```

### Task 5: Record evidence, review, and integrate

**Files:**

- Modify: `STATUS.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/architecture/data-model.md`
- Modify: `docs/architecture/pos-native-foundation.md`
- Add: `docs/architecture/DONOR_MATRIX.md`
- Modify: this plan

- [x] **Step 1: Update truthful documentation**

  Record the page hierarchy policy, API/browser behavior, synthetic evidence,
  and remaining PostgreSQL/browser/Docker/owner/backup/migration gates. Set the
  next product slice to structured data sources and relations only after this
  slice is accepted.

- [x] **Step 2: Run full verification**

  ```sh
  npm run verify
  npm run db:generate
  npm run build -- --listEmittedFiles
  npm audit --omit=dev --json
  git diff --check
  git status --short
  ```

- [x] **Step 3: Obtain independent review and repair valid findings**

  Use a fresh reviewer on the exact worktree/branch. Fix every Critical or
  Important finding through a focused regression test, then rerun the affected
  verification. Document intentional live gates separately from defects.

  Review outcome on 2026-09-23: no Critical findings. Three Important findings
  were repaired through red-to-green regressions: archive-state enforcement at
  the block-document persistence boundary; navigation reconciliation after a
  late successful title/move/archive/restore response; and preservation of an
  unsaved title draft through archive/restore. The opt-in PostgreSQL archive
  regression is intentionally skipped without `TEST_DATABASE_URL`; it is not
  counted as live persistence proof.

- [x] **Step 4: Commit and fast-forward only if clean**

  ```sh
  git add STATUS.md CHANGELOG.md docs/architecture/data-model.md docs/architecture/pos-native-foundation.md docs/superpowers/plans/2026-09-21-page-hierarchy.md
  git commit -m "docs: record page hierarchy verification"
  git status --short
  git log --oneline main..HEAD
  ```

  Preserve this worktree as a recovery point after a clean fast-forward. Do not
  delete it.

## Deferred work

- Drag/drop, bulk hierarchy changes, subtree archive/restore, page icons/covers,
  rich editor installation and rich block types.
- Data sources, records, typed properties, relations, rollups, formulas, and
  saved views.
- Links/backlinks, search, asset upload/download, export, MCP, deployment, and
  all Notion migration/cutover work.
- Live PostgreSQL migration/restart proof, real browser/mobile acceptance,
  owner bootstrap, Docker runtime, and backup/restore rehearsal.
