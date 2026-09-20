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
form or enables the already-existing page workspace. It continues to use the
server-owned session cookie and the double-submit CSRF cookie/header contract;
the browser never stores credentials or tokens outside the browser cookie jar.

**Tech Stack:** ES modules, browser DOM, Fetch API, Fastify v5, Vitest v5.

**Spec:** `docs/specs/pos-native-v1.md` (which records the authoritative v2
master brief).

## Global Constraints

- Notion remains untouched and canonical; use no live Notion data.
- Do not add a client-side account store, token store, telemetry, analytics,
  package, or external authentication provider.
- Use same-origin fetches with `credentials: "same-origin"`; preserve the
  existing server-side secure, HttpOnly session cookie and readable CSRF cookie.
- The workspace must remain hidden and must not query page data until a valid
  `/api/v1/auth/session` response is received.
- Login, session, and logout failures must use safe generic user-facing text;
  do not insert server responses with `innerHTML` or surface credentials.
- Logout may reveal the login form only after the server confirms the CSRF-bound
  logout request; a missing CSRF cookie is a failure, not a local logout.
- Do not claim live database, browser, restart, backup, restore, migration, or
  cutover acceptance without their separate environment gates.

## Review Focus

- An expired or absent session receives a 401 and leaves the workspace hidden;
  it must not request `/api/v1/pages`.
- A 200 session response without `authenticated: true` is untrusted and must
  also leave the workspace hidden.
- A failed login shows generic credential feedback and never exposes a server
  response or password value.
- A logout action without a readable CSRF cookie must keep the current
  workspace state rather than claiming the server session is gone.
- A session-check network/server error must render a generic availability
  message rather than treating the user as authenticated.

---

### Task 1: Testable authentication request boundary

**Files:**

- Modify: `apps/web/app.js`
- Modify: `apps/api/test/web-shell.test.ts`

**Interfaces:**

- Consumes: `fetch(url, options)` and the existing `/api/v1/auth/login`,
  `/api/v1/auth/session`, and `/api/v1/auth/logout` API contracts.
- Produces: `getSessionRequest(apiFetch): Promise<boolean>`,
  `loginRequest(apiFetch, email, password): Promise<void>`, and
  `logoutRequest(apiFetch, csrfToken): Promise<void>` for the browser
  controller in Task 2.

- [x] **Step 1: Write failing tests for the authenticated request contract**

  Add exact assertions to `apps/api/test/web-shell.test.ts` that:

  ```ts
  await expect(getSessionRequest(apiFetch)).resolves.toBe(false);
  expect(apiFetch).toHaveBeenCalledWith("/api/v1/auth/session", {
    credentials: "same-origin",
    method: "GET",
  });

  await loginRequest(apiFetch, "owner@example.test", "secret");
  expect(apiFetch).toHaveBeenCalledWith("/api/v1/auth/login", {
    body: JSON.stringify({ email: "owner@example.test", password: "secret" }),
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  ```

  Include 401 and malformed-200 session tests, a generic failure assertion for
  a 500 session response, and an assertion that `logoutRequest` rejects before
  calling fetch when passed an empty CSRF token.

- [x] **Step 2: Run the focused test to verify it fails**

  Run: `npm test -- apps/api/test/web-shell.test.ts`

  Expected: FAIL because the three authentication request helpers do not yet
  exist.

- [x] **Step 3: Implement only the request helpers**

  In `apps/web/app.js`, add the exports from the interface block. Give every
  browser request `{ credentials: "same-origin" }`. Treat only a 200 JSON body
  with `authenticated === true` as a valid session, return `false` for 401,
  and throw a generic `Error("NativePOS is unavailable")` for malformed or
  unexpected responses. Require a non-empty CSRF token before logout, send it
  through the existing `unsafeHeaders`, and accept only a successful response.

- [x] **Step 4: Run the focused test to verify it passes**

  Run: `npm test -- apps/api/test/web-shell.test.ts`

  Expected: PASS.

- [x] **Step 5: Commit the tested request boundary**

  ```bash
  git add apps/web/app.js apps/api/test/web-shell.test.ts
  git commit -m "feat: add browser authentication requests"
  ```

### Task 2: Authentication-gated accessible browser shell

**Files:**

- Modify: `apps/web/index.html`
- Modify: `apps/web/styles.css`
- Modify: `apps/web/app.js`
- Modify: `apps/api/test/web-shell.test.ts`

**Interfaces:**

- Consumes: Task 1 request helpers and `startBrowserApp(documentObject,
apiFetch)` inputs.
- Produces: an accessible `#login-form`, `#workspace`, and `#logout` control;
  the `startBrowserApp` controller can be exercised from a fake DOM without a
  new browser-testing dependency.

- [ ] **Step 1: Write failing workspace-gating tests and shell assertions**

  Extend `apps/api/test/web-shell.test.ts` with a small `FakeDocument` and
  `FakeElement` that support `querySelector`, `createElement`, `hidden`,
  `value`, `textContent`, `disabled`, `replaceChildren`, `append`, event
  listeners, and form-submit `preventDefault`. Add tests that:

  ```ts
  await startBrowserApp(documentObject, apiFetch);
  expect(workspace.hidden).toBe(true);
  expect(apiFetch).not.toHaveBeenCalledWith("/api/v1/pages", expect.anything());

  await loginForm.emit("submit");
  expect(workspace.hidden).toBe(false);
  expect(apiFetch).toHaveBeenCalledWith("/api/v1/pages", {
    credentials: "same-origin",
    method: "GET",
  });
  ```

  Cover a 500 session probe rendering `NativePOS is unavailable.`, a bad login
  rendering `Incorrect email or password.`, and a missing-CSRF logout keeping
  the workspace visible. Extend the server shell assertion with the login
  form, `autocomplete="username"`, `autocomplete="current-password"`, an
  initially hidden workspace, and an accessible logout button.

- [ ] **Step 2: Run the focused test to verify it fails**

  Run: `npm test -- apps/api/test/web-shell.test.ts`

  Expected: FAIL because `startBrowserApp` and the login shell are absent.

- [ ] **Step 3: Implement the login shell and controller**

  Replace the always-visible workspace in `apps/web/index.html` with:

  ```html
  <main
    id="login-panel"
    class="login-panel"
    aria-labelledby="login-title"
  ></main>
  ```
