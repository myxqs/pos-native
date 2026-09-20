/* global document, fetch */

export async function createPageRequest(apiFetch, title, csrfToken) {
  return requestJson(apiFetch, "/api/v1/pages", {
    credentials: "same-origin",
    method: "POST",
    headers: unsafeHeaders(csrfToken),
    body: JSON.stringify({ title }),
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
    credentials: "same-origin",
    method: "PATCH",
    headers: unsafeHeaders(csrfToken, {
      "if-match": String(revisionNumber),
    }),
    body: JSON.stringify({ title }),
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

function csrfTokenFromDocument() {
  const cookie = document.cookie
    .split("; ")
    .find((value) => value.startsWith("pos_csrf="));
  return cookie ? decodeURIComponent(cookie.slice("pos_csrf=".length)) : "";
}

async function requestJson(apiFetch, url, options) {
  const response = await apiFetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "request failed");
  return body;
}

async function start() {
  const form = document.querySelector("#create-page");
  const newTitle = document.querySelector("#new-page-title");
  const pageTitle = document.querySelector("#page-title");
  const save = document.querySelector("#save-page");
  const list = document.querySelector("#page-list");
  const editor = document.querySelector("#editor");
  const empty = document.querySelector("#empty-state");
  const status = document.querySelector("#status");
  let selectedId = null;
  let selectedRevisionNumber = null;

  async function selectPage(id) {
    try {
      const result = await requestJson(fetch, "/api/v1/pages/" + id, {
        method: "GET",
      });
      selectedId = result.page.id;
      selectedRevisionNumber = result.revisionNumber;
      pageTitle.value = result.page.title;
      editor.hidden = false;
      empty.hidden = true;
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "Could not load page.";
    }
  }

  async function refresh() {
    const response = await fetch("/api/v1/pages");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "could not load pages");
    list.replaceChildren(
      ...body.pages.map((page) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
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

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await createPageRequest(
        fetch,
        newTitle.value,
        csrfTokenFromDocument(),
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
      status.textContent =
        error instanceof Error ? error.message : "Create failed.";
    }
  });

  save.addEventListener("click", async () => {
    if (!selectedId || !selectedRevisionNumber) return;
    try {
      const result = await updatePageRequest(
        fetch,
        selectedId,
        pageTitle.value,
        selectedRevisionNumber,
        csrfTokenFromDocument(),
      );
      selectedRevisionNumber = result.revisionNumber;
      status.textContent = "Page saved.";
      await refresh();
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "Save failed.";
    }
  });

  try {
    await refresh();
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : "NativePOS is unavailable.";
  }
}

if (typeof document !== "undefined") void start();
