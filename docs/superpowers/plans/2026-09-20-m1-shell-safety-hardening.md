# M1 Shell Safety Hardening Implementation Plan

> For agentic workers: use the executing-plans workflow task-by-task.

**Goal:** Make browser page mutations CSRF-correct, reject stale page updates safely, and make runtime web assets explicit.

**Architecture:** The browser reads the readable double-submit CSRF cookie set at login and sends it only with unsafe requests. A page current_revision_number is the PostgreSQL compare-and-swap value. API clients provide If-Match and receive conflicts instead of overwriting later changes. Fastify serves three allowlisted assets from a resolved configurable root.

**Tech Stack:** Node.js 24, TypeScript 6, Fastify 5, Drizzle ORM, PostgreSQL 18, plain ES modules, Vitest 5.

**Spec:** docs/specs/pos-native-v1.md

## Global Constraints

- Notion stays untouched and canonical; tests use synthetic data only.
- Raw passwords, session tokens, and CSRF tokens are never persisted or logged.
- Page, revision, and audit writes remain one transaction.
- Stale writes return an explicit conflict and cannot overwrite a later page state.
- No claim of live PostgreSQL or browser persistence without a live test database and runtime.
- Web serving cannot depend accidentally on the TypeScript source layout.

## Review Focus

- Headerless POST/PATCH fails CSRF while the current double-submit token succeeds.
- A second editor saving an old revision gets 409 and never overwrites a newer title.
- Missing or malformed If-Match is rejected as client input, not an audit event.
- A missing configured web root fails explicitly.

### Task 1: Browser CSRF and revision-aware client

**Files:**

- Modify: apps/web/index.html
- Modify: apps/web/app.js
- Test: apps/api/test/web-shell.test.ts

**Interfaces:**

- Consumes: pos_csrf cookie and GET /api/v1/pages/:id response with page and revisionNumber.
- Produces: createPageRequest(apiFetch, title, csrfToken) and updatePageRequest(apiFetch, id, title, revisionNumber, csrfToken).

- [x] Step 1: Write a failing request-shape test.

  expect(apiFetch).toHaveBeenNthCalledWith(2, "/api/v1/pages/page-1", {
  method: "PATCH",
  headers: {
  "content-type": "application/json",
  "if-match": "1",
  "x-pos-csrf": "csrf-token",
  },
  body: JSON.stringify({ title: "Projects" }),
  });

- [x] Step 2: Run npm test -- apps/api/test/web-shell.test.ts. It must fail because the current client sends only content-type.
- [x] Step 3: Read pos_csrf from document.cookie, fetch the selected page revision, send x-pos-csrf on POST/PATCH and if-match on PATCH, then update the selected revision after a save.
- [x] Step 4: Run npm test -- apps/api/test/web-shell.test.ts and npm test.
- [x] Step 5: Commit with fix: send browser CSRF and revision headers.

### Task 2: Optimistic revision control

**Files:**

- Modify: packages/database/src/schema.ts
- Create: generated packages/database/drizzle/0002 migration
- Modify: packages/database/src/page-repository.ts
- Modify: packages/database/src/postgres-page-repository.ts
- Modify: packages/database tests
- Modify: apps/api/src/page-routes.ts
- Modify: apps/api/test/page-routes.test.ts

**Interfaces:**

- Consumes: positive-integer If-Match equal to the current revision.
- Produces: PageRevisionConflictError, pages.current_revision_number, and 409 with page revision conflict.

- [x] Step 1: Write failing missing, malformed, and stale API tests.

  const stale = await app.inject({
  method: "PATCH",
  url: "/api/v1/pages/" + id,
  headers: { "if-match": "1" },
  payload: { title: "Stale title" },
  });
  expect(stale.statusCode).toBe(409);
  expect(stale.json()).toEqual({ error: "page revision conflict" });

- [x] Step 2: Run npm test -- apps/api/test/page-routes.test.ts packages/database/test/page-repository.test.ts. It must fail because headerless writes are accepted.
- [x] Step 3: Add a non-null currentRevisionNumber, generate a new migration, persist 1 on creates, read the counter with pages, and update WHERE id and current_revision_number match. A zero-row update throws PageRevisionConflictError and rolls back all writes.
- [x] Step 4: Reject missing/malformed If-Match with 400; map pre-read and repository conflicts to 409.
- [x] Step 5: Run the focused tests, npm run db:generate, then npm test.
- [x] Step 6: Commit with fix: reject stale page revisions.

### Task 3: Explicit web asset root

**Files:**

- Create: apps/api/src/web-assets.ts
- Modify: apps/api/src/app.ts
- Test: apps/api/test/web-shell.test.ts
- Modify: docs/operations/development.md

**Interfaces:**

- Consumes: optional AppOptions.webAssetRoot and optional POS_WEB_ASSET_ROOT.
- Produces: slash, slash app.js, and slash styles.css routes, or NativePOS web assets are unavailable.

- [x] Step 1: Write a failing resolver test.

  expect(() => resolveWebAssetRoot("C:/missing-nativepos-assets")).toThrow(
  "NativePOS web assets are unavailable",
  );

- [x] Step 2: Run npm test -- apps/api/test/web-shell.test.ts. It must fail because the resolver is missing.
- [x] Step 3: Implement the resolver with resolve, relative, and existsSync, validating index.html, app.js, and styles.css below a single root. Keep Fastify routes allowlisted.
- [x] Step 4: Document that production composition must supply POS_WEB_ASSET_ROOT for a copied/package-managed apps/web directory; do not claim an emitted runtime yet.
- [x] Step 5: Run npm test -- apps/api/test/web-shell.test.ts then npm run verify.
- [x] Step 6: Commit with fix: make web asset root explicit.

### Task 4: Checkpoint and review

- [x] Step 1: Run npm run verify, npm audit --omit=dev --json, and git diff --check.
- [x] Step 2: Record test counts plus the still-blocked live PostgreSQL and production runtime gates in STATUS.md and CHANGELOG.md.
- [x] Step 3: Commit with docs: record M1 safety hardening.
- [ ] Step 4: Request a fresh branch review, fix critical or important findings test-first, and rerun evidence.

## Self-review

This narrow plan resolves only reviewed defects. It adds no external package, Notion connection, importer, migration, or cutover. A durable PostgreSQL-backed account/session runtime and live acceptance test remain the next M1 work after Docker can run.
