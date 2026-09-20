/* global document, fetch */

export async function createPageRequest(apiFetch, title, csrfToken) {
  return requestJson(apiFetch, "/api/v1/pages", {
    body: JSON.stringify({ title }),
    credentials: "same-origin",
    headers: unsafeHeaders(csrfToken),
    method: "POST",
  });
}

export async function updatePageRequest(
  apiFetch,
  id,
  title,
  revisionNumber,
  csrfToken,
) {
  return requestJson(apiFetch, "/api/v1/pages/" + id, {
    body: JSON.stringify({ title }),
    credentials: "same-origin",
    headers: unsafeHeaders(csrfToken, {
      "if-match": String(revisionNumber),
    }),
    method: "PATCH",
  });
}

export async function getSessionRequest(apiFetch) {
  const response = await apiFetch("/api/v1/auth/session", {
    credentials: "same-origin",
    method: "GET",
  });
  if (response.status === 401) return false;
  if (!response.ok) throw new Error("NativePOS is unavailable");

  try {
    const body = await response.json();
    return body?.authenticated === true;
  } catch {
    throw new Error("NativePOS is unavailable");
  }
}

export async function loginRequest(apiFetch, email, password) {
  await requestJson(apiFetch, "/api/v1/auth/login", {
    body: JSON.stringify({ email, password }),
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export async function logoutRequest(apiFetch, csrfToken) {
  if (!csrfToken) throw new Error("CSRF token is unavailable");

  const response = await apiFetch("/api/v1/auth/logout", {
    credentials: "same-origin",
    headers: unsafeHeaders(csrfToken),
    method: "POST",
  });
  if (!response.ok) throw new Error("Unable to sign out");
}

function unsafeHeaders(csrfToken, extraHeaders = {}) {
  if (!csrfToken) throw new Error("CSRF token is unavailable");
  return {
    "content-type": "application/json",
    "x-pos-csrf": csrfToken,
    ...extraHeaders,
  };
}

function csrfTokenFromDocument(documentObject) {
  const cookie = documentObject.cookie
    .split("; ")
    .find((value) => value.startsWith("pos_csrf="));
  return cookie ? decodeURIComponent(cookie.slice("pos_csrf=".length)) : "";
}

function createRequestError(statusCode) {
  const error = new Error("request failed");
  error.statusCode = statusCode;
  return error;
}

function isAuthenticationError(error) {
  return error instanceof Error && error.statusCode === 401;
}

function requiredElement(documentObject, selector) {
  const element = documentObject.querySelector(selector);
  if (!element) throw new Error("NativePOS browser shell is unavailable");
  return element;
}

async function requestJson(apiFetch, url, options) {
  const response = await apiFetch(url, options);
  let body;
  try {
    body = await response.json();
  } catch {
    if (!response.ok) throw createRequestError(response.status);
    throw new Error("NativePOS is unavailable");
  }
  if (!response.ok) throw createRequestError(response.status);
  return body;
}

export async function startBrowserApp(
  documentObject = document,
  apiFetch = fetch,
) {
  const loginPanel = requiredElement(documentObject, "#login-panel");
  const loginForm = requiredElement(documentObject, "#login-form");
  const loginEmail = requiredElement(documentObject, "#login-email");
  const loginPassword = requiredElement(documentObject, "#login-password");
  const loginSubmit = requiredElement(documentObject, "#login-submit");
  const loginStatus = requiredElement(documentObject, "#login-status");
  const workspace = requiredElement(documentObject, "#workspace");
  const logout = requiredElement(documentObject, "#logout");
  const form = requiredElement(documentObject, "#create-page");
  const newTitle = requiredElement(documentObject, "#new-page-title");
  const pageTitle = requiredElement(documentObject, "#page-title");
  const save = requiredElement(documentObject, "#save-page");
  const list = requiredElement(documentObject, "#page-list");
  const editor = requiredElement(documentObject, "#editor");
  const empty = requiredElement(documentObject, "#empty-state");
  const status = requiredElement(documentObject, "#status");
  let selectedId = null;
  let selectedRevisionNumber = null;

  function showLogin(message = "") {
    loginPanel.hidden = false;
    workspace.hidden = true;
    loginStatus.textContent = message;
    selectedId = null;
    selectedRevisionNumber = null;
    editor.hidden = true;
    empty.hidden = false;
  }

  function showWorkspace() {
    loginPanel.hidden = true;
    workspace.hidden = false;
    loginStatus.textContent = "";
  }

  function handleWorkspaceFailure(error, fallback) {
    if (isAuthenticationError(error)) {
      showLogin("Your session has ended. Please sign in again.");
      return;
    }
    status.textContent = fallback;
  }

  async function selectPage(id) {
    try {
      const result = await requestJson(apiFetch, "/api/v1/pages/" + id, {
        credentials: "same-origin",
        method: "GET",
      });
      selectedId = result.page.id;
      selectedRevisionNumber = result.revisionNumber;
      pageTitle.value = result.page.title;
      editor.hidden = false;
      empty.hidden = true;
    } catch (error) {
      handleWorkspaceFailure(error, "Could not load page.");
    }
  }

  async function refresh() {
    const body = await requestJson(apiFetch, "/api/v1/pages", {
      credentials: "same-origin",
      method: "GET",
    });
    if (!Array.isArray(body.pages)) throw new Error("NativePOS is unavailable");
    list.replaceChildren(
      ...body.pages.map((page) => {
        const item = documentObject.createElement("li");
        const button = documentObject.createElement("button");
        button.type = "button";
        button.textContent = page.title;
        button.addEventListener("click", () => {
          void selectPage(page.id);
        });
        item.append(button);
        return item;
      }),
    );
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginSubmit.disabled = true;
    try {
      await loginRequest(apiFetch, loginEmail.value, loginPassword.value);
      loginPassword.value = "";
      showWorkspace();
      await refresh();
    } catch (error) {
      showLogin(
        isAuthenticationError(error)
          ? "Incorrect email or password."
          : "NativePOS is unavailable.",
      );
    } finally {
      loginSubmit.disabled = false;
    }
  });

  logout.addEventListener("click", async () => {
    logout.disabled = true;
    try {
      await logoutRequest(apiFetch, csrfTokenFromDocument(documentObject));
      showLogin();
    } catch {
      status.textContent = "Could not sign out.";
    } finally {
      logout.disabled = false;
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await createPageRequest(
        apiFetch,
        newTitle.value,
        csrfTokenFromDocument(documentObject),
      );
      newTitle.value = "";
      selectedId = result.page.id;
      selectedRevisionNumber = result.revisionNumber;
      pageTitle.value = result.page.title;
      editor.hidden = false;
      empty.hidden = true;
      status.textContent = "Page created.";
      await refresh();
    } catch (error) {
      handleWorkspaceFailure(error, "Could not create page.");
    }
  });

  save.addEventListener("click", async () => {
    if (!selectedId || selectedRevisionNumber === null) return;
    try {
      const result = await updatePageRequest(
        apiFetch,
        selectedId,
        pageTitle.value,
        selectedRevisionNumber,
        csrfTokenFromDocument(documentObject),
      );
      selectedRevisionNumber = result.revisionNumber;
      status.textContent = "Page saved.";
      await refresh();
    } catch (error) {
      handleWorkspaceFailure(error, "Could not save page.");
    }
  });

  showLogin();
  try {
    if (await getSessionRequest(apiFetch)) {
      showWorkspace();
      await refresh();
    }
  } catch (error) {
    if (isAuthenticationError(error)) {
      showLogin("Your session has ended. Please sign in again.");
    } else {
      showLogin("NativePOS is unavailable.");
    }
  }
}

if (typeof document !== "undefined") void startBrowserApp();
