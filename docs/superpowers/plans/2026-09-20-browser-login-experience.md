# Browser Login Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the NativePOS browser shell usable only after a local owner has
signed in or a valid session has been restored, with a safe sign-out path.

**Architecture:** Keep the existing dependency-free browser module. Export
small request helpers and a `startBrowserApp(documentObject, apiFetch)`
controller so Node-based tests can use a minimal fake DOM. The controller first
checks the existing same-origin session endpoint, then either renders the login
form or enables the page workspace. It continues to use the server-owned
session cookie and double-submit CSRF cookie/header; the browser never stores
credentials or tokens outside the browser cookie jar.

**Tech Stack:** ES modules, browser DOM, Fetch API, Fastify v5, Vitest v5.

**Spec:** `docs/specs/pos-native-v1.md` (which records the authoritative v2
master brief).

## Global Constraints

- Notion remains untouched and canonical; use no live Notion data.
- Do not add a client-side account store, token store, telemetry, analytics,
  package, or external authentication provider.
- Use same-origin fetches with `credentials: "same-origin"`; preserve the
  secure HttpOnly session cookie and readable CSRF cookie.
- The workspace remains hidden and must not query page data until a valid
  `/api/v1/auth/session` response has been received.
- Login, session, and logout failures use generic user-facing text; do not use
  `innerHTML` or surface server responses or credentials.
- Logout may reveal the login form only after the server confirms the
  CSRF-bound logout request; a missing CSRF cookie is a failure, not a local
  logout.
- Do not claim live database, browser, restart, backup, restore, migration, or
  cutover acceptance without their separate environment gates.

## Review Focus

- A missing or expired session gets 401 and leaves the workspace hidden without
  a page-list request.
- A 200 session response without `authenticated: true` is untrusted and also
  leaves the workspace hidden.
- A failed login shows generic credential feedback without a server response or
  password value.
- A logout without a readable CSRF cookie keeps the workspace state rather than
  claiming the server session ended.
- A session-check server/network failure renders generic availability feedback
  and never authenticates the browser.

---

### Task 1: Testable authentication request boundary

**Files:**

- Modify: `apps/web/app.js`
- Modify: `apps/api/test/web-shell.test.ts`

**Interfaces:**

- Consumes: `fetch(url, options)` and the existing auth API routes.
- Produces: `getSessionRequest(apiFetch): Promise<boolean>`,
  `loginRequest(apiFetch, email, password): Promise<void>`, and
  `logoutRequest(apiFetch, csrfToken): Promise<void>`.

- [x] **Step 1: Write failing tests for the authenticated request contract**

  Tests assert exact same-origin fetch options, a valid true session response,
  401 and malformed false session responses, generic 500 failure, and rejection
  before fetch for an empty CSRF logout token.

- [x] **Step 2: Run the focused test to verify it fails**

  Run: `npm test -- apps/api/test/web-shell.test.ts`

  Result: FAIL because the helpers were not exported and existing mutations had
  no explicit credentials.

- [x] **Step 3: Implement only the request helpers**

  ```js
  export async function getSessionRequest(apiFetch) {
    const response = await apiFetch("/api/v1/auth/session", {
      credentials: "same-origin",
      method: "GET",
    });
    if (response.status === 401) return false;
    if (!response.ok) throw new Error("NativePOS is unavailable");
    return (await response.json())?.authenticated === true;
  }
  ```

  The login and logout helpers use the existing JSON and CSRF rules; every
  browser request explicitly uses same-origin credentials.

- [x] **Step 4: Run the focused test to verify it passes**

  Run: `npm test -- apps/api/test/web-shell.test.ts`

  Result: PASS, 8/8 tests.

- [x] **Step 5: Commit the tested request boundary**

  Commit: `8e435c0 feat: add browser authentication requests`.

### Task 2: Authentication-gated accessible browser shell

**Files:**

- Modify: `apps/web/index.html`
- Modify: `apps/web/styles.css`
- Modify: `apps/web/app.js`
- Modify: `apps/api/test/web-shell.test.ts`

**Interfaces:**

- Consumes: Task 1 helper exports and `startBrowserApp(documentObject,
apiFetch)` inputs.
- Produces: accessible `#login-form`, initially hidden `#workspace`, and
  `#logout` controls, with a controller independently tested through a fake
  DOM.

- [x] **Step 1: Write failing workspace-gating and shell tests**

  A minimal `FakeDocument` and `FakeElement` support selectors, values,
  hidden state, listeners, replacement children, and submitted forms. Tests
  cover unauthenticated restore, successful sign-in and page refresh, safe
  unavailable/invalid-login feedback, and missing-CSRF logout. Shell assertions
  cover login form labels, autocomplete values, initial workspace hiding, and
  logout control.

- [x] **Step 2: Run the focused test to verify it fails**

  Run: `npm test -- apps/api/test/web-shell.test.ts`

  Result: FAIL because the shell and `startBrowserApp` export were absent.

- [x] **Step 3: Implement the login shell and controller**

  ```js
  export async function startBrowserApp(
    documentObject = document,
    apiFetch = fetch,
  ) {
    // attach handlers before probing the session
    // show login for 401 or untrusted JSON
    // only reveal workspace after a valid session or successful login
  }
  ```

  The HTML contains a labeled login form using `autocomplete="username"` and
  `autocomplete="current-password"`. The controller clears the password after
  successful login, maps browser messages to safe fixed text, uses
  `textContent`, redirects page-request 401s to a session-ended login state,
  and keeps the workspace visible when server logout cannot be proven.

- [x] **Step 4: Run focused controller and shell tests to verify they pass**

  Run: `npm test -- apps/api/test/web-shell.test.ts` and `npm run lint`

  Result: PASS, 12/12 focused tests; lint exits zero.

- [x] **Step 5: Commit the authenticated browser experience**

  Commit: `eaceb6b feat: add browser login experience`.

### Task 3: Verification, status, and checkpoint review

**Files:**

- Modify: `STATUS.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-09-20-browser-login-experience.md`

**Interfaces:**

- Consumes: Task 1 and Task 2 browser contracts.
- Produces: a truthful handover that distinguishes synthetic controller
  coverage from still-blocked live PostgreSQL and browser acceptance.

- [x] **Step 1: Update status and changelog evidence**

  Record browser login/session restore/logout controller coverage and its test
  count. Retain the blockers: no live owner account, no PostgreSQL runtime, no
  authenticated real-browser acceptance, and no migration/cutover authority.

- [x] **Step 2: Run full verification and repository checks**

  Run:

  ```bash
  npm run verify
  npm run db:generate
  npm run build -- --listEmittedFiles
  npm audit --omit=dev --json
  git diff --check
  ```

  Expected: format, lint, typecheck, tests, build, migration generation, audit,
  and whitespace checks succeed. Test source is absent from fresh build output;
  the two opt-in PostgreSQL tests remain skipped without `TEST_DATABASE_URL`.

  Result: PASS on 2026-09-20 — `npm run verify` reported 56 passing tests and
  two intentionally skipped PostgreSQL tests; generation reported no schema
  changes; the fresh build emitted no test source; the production dependency
  audit reported zero vulnerabilities; and both Git whitespace checks passed.

- [x] **Step 3: Request independent review and repair any P1/P2 finding**

  Supply the review package, this plan, status constraints, and review focus.
  For a valid P1/P2 finding, first add a minimal regression test, verify RED,
  apply the smallest fix, verify GREEN and the full suite, then record the
  repair in this plan.

  The first independent review found three Important defects. Each was repaired
  test-first: the logout helper no longer supplies `content-type` without a
  body and now passes through Fastify; login requires `{ authenticated: true }`
  and a follow-up session check before loading pages; and an authentication
  generation prevents stale session probes from reopening the workspace after
  login or logout. Extra regression coverage now covers malformed/untrusted
  login results, rejected session probes, and controller logout. The focused
  repair suite passed 20/20, the full suite passed as recorded above, and the
  post-fix independent review found no Important or Critical issue.

- [x] **Step 4: Commit the evidence checkpoint**

  ```bash
  git add STATUS.md CHANGELOG.md docs/superpowers/plans/2026-09-20-browser-login-experience.md
  git commit -m "docs: record browser login verification"
  ```

  Commit: `docs: record browser login verification`.

## Plan self-review

- Coverage: session restoration, absent/malformed sessions, explicit and
  malformed login results, stale authentication responses, rejected probes,
  logout, shell accessibility, same-origin cookies, and generic failure
  messages each have an owning test.
- Interfaces: Task 2 consumes the exact Task 1 export names; Task 3 changes no
  runtime interface.
- Scope: this plan does not add registration, password reset, MFA, PWA/offline
  support, database migration, backup, or any Notion operation.
- Review focus: every listed browser input class has explicit focused coverage;
  post-fix review found no Important or Critical issue. This remains synthetic
  controller coverage, not live browser or PostgreSQL acceptance.
