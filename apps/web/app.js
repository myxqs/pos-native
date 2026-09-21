/* global document, fetch */

export async function createPageRequest(apiFetch, title, csrfToken) {
  return requestJson(apiFetch, "/api/v1/pages", {
    body: JSON.stringify({ title }),
    credentials: "same-origin",
    headers: jsonHeaders(csrfToken),
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
    headers: jsonHeaders(csrfToken, {
      "if-match": String(revisionNumber),
    }),
    method: "PATCH",
  });
}

export async function getBlockDocumentRequest(apiFetch, id) {
  const body = await requestJson(apiFetch, "/api/v1/pages/" + id + "/blocks", {
    credentials: "same-origin",
    method: "GET",
  });
  return blockDocumentFromResponse(body, id);
}

export async function updateBlockDocumentRequest(
  apiFetch,
  id,
  blocks,
  revisionNumber,
  csrfToken,
) {
  if (!Number.isSafeInteger(revisionNumber) || revisionNumber < 0) {
    throw new Error("block document revision is invalid");
  }
  const body = await requestJson(apiFetch, "/api/v1/pages/" + id + "/blocks", {
    body: JSON.stringify({ blocks }),
    credentials: "same-origin",
    headers: jsonHeaders(csrfToken, {
      "if-match": '"' + String(revisionNumber) + '"',
    }),
    method: "PUT",
  });
  return blockDocumentFromResponse(body, id);
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
  const body = await requestJson(apiFetch, "/api/v1/auth/login", {
    body: JSON.stringify({ email, password }),
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (body?.authenticated !== true) throw new Error("NativePOS is unavailable");
}

export async function logoutRequest(apiFetch, csrfToken) {
  if (!csrfToken) throw new Error("CSRF token is unavailable");

  const response = await apiFetch("/api/v1/auth/logout", {
    credentials: "same-origin",
    headers: csrfHeaders(csrfToken),
    method: "POST",
  });
  if (!response.ok) throw new Error("Unable to sign out");
}

function csrfHeaders(csrfToken, extraHeaders = {}) {
  if (!csrfToken) throw new Error("CSRF token is unavailable");
  return {
    "x-pos-csrf": csrfToken,
    ...extraHeaders,
  };
}

function jsonHeaders(csrfToken, extraHeaders = {}) {
  return {
    "content-type": "application/json",
    ...csrfHeaders(csrfToken, extraHeaders),
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

function isPlainRecord(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function blockDocumentFromResponse(value, pageId) {
  if (!isPlainRecord(value) || !isPlainRecord(value.document)) {
    throw new Error("NativePOS is unavailable");
  }
  const document = value.document;
  if (
    document.pageId !== pageId ||
    !Number.isSafeInteger(document.revisionNumber) ||
    document.revisionNumber < 0 ||
    !Array.isArray(document.blocks)
  ) {
    throw new Error("NativePOS is unavailable");
  }
  return document;
}

function editableParagraph(document) {
  if (document.blocks.length === 0) {
    return { blockId: null, revisionNumber: document.revisionNumber, text: "" };
  }
  if (document.blocks.length !== 1) return null;
  const block = document.blocks[0];
  if (
    !isPlainRecord(block) ||
    typeof block.id !== "string" ||
    block.id.length === 0 ||
    block.parentBlockId !== null ||
    block.blockType !== "paragraph" ||
    block.position !== 0 ||
    !isPlainRecord(block.content) ||
    typeof block.content.text !== "string"
  ) {
    return null;
  }
  return {
    blockId: block.id,
    revisionNumber: document.revisionNumber,
    text: block.content.text,
  };
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
  const pageBody = requiredElement(documentObject, "#page-body");
  const saveBody = requiredElement(documentObject, "#save-body");
  const bodyStatus = requiredElement(documentObject, "#body-status");
  const list = requiredElement(documentObject, "#page-list");
  const editor = requiredElement(documentObject, "#editor");
  const empty = requiredElement(documentObject, "#empty-state");
  const status = requiredElement(documentObject, "#status");
  let selectedId = null;
  let selectedRevisionNumber = null;
  let selectedBodyRevisionNumber = null;
  let selectedBodyBlockId = null;
  let authenticationGeneration = 0;
  let pageSelectionGeneration = 0;
  let bodySaveSequence = 0;

  function resetBodyEditor() {
    selectedBodyRevisionNumber = null;
    selectedBodyBlockId = null;
    pageBody.value = "";
    pageBody.disabled = true;
    saveBody.disabled = true;
    bodyStatus.textContent = "";
  }

  function showEditableBody(document) {
    const paragraph = editableParagraph(document);
    if (!paragraph) {
      resetBodyEditor();
      bodyStatus.textContent =
        "This page body cannot be edited in this version.";
      return false;
    }
    selectedBodyRevisionNumber = paragraph.revisionNumber;
    selectedBodyBlockId = paragraph.blockId;
    pageBody.value = paragraph.text;
    pageBody.disabled = false;
    saveBody.disabled = false;
    bodyStatus.textContent = "";
    return true;
  }

  function showLogin(message = "") {
    pageSelectionGeneration += 1;
    loginPanel.hidden = false;
    workspace.hidden = true;
    loginStatus.textContent = message;
    selectedId = null;
    selectedRevisionNumber = null;
    resetBodyEditor();
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
    const selectionGeneration = ++pageSelectionGeneration;
    let metadataLoaded = false;
    selectedId = null;
    selectedRevisionNumber = null;
    resetBodyEditor();
    editor.hidden = true;
    empty.hidden = false;
    try {
      const result = await requestJson(apiFetch, "/api/v1/pages/" + id, {
        credentials: "same-origin",
        method: "GET",
      });
      if (selectionGeneration !== pageSelectionGeneration) return;
      selectedId = result.page.id;
      selectedRevisionNumber = result.revisionNumber;
      metadataLoaded = true;
      pageTitle.value = result.page.title;
      editor.hidden = false;
      empty.hidden = true;

      const blockDocument = await getBlockDocumentRequest(apiFetch, selectedId);
      if (selectionGeneration !== pageSelectionGeneration) return;
      showEditableBody(blockDocument);
    } catch (error) {
      if (selectionGeneration !== pageSelectionGeneration) return;
      if (metadataLoaded) {
        resetBodyEditor();
        if (isAuthenticationError(error)) {
          showLogin("Your session has ended. Please sign in again.");
        } else {
          bodyStatus.textContent = "Could not load page body.";
        }
        return;
      }
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
        button.addEventListener("click", async () => {
          await selectPage(page.id);
        });
        item.append(button);
        return item;
      }),
    );
  }

  async function revealWorkspace(generation) {
    await refresh();
    if (generation !== authenticationGeneration) return false;
    showWorkspace();
    return true;
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const generation = ++authenticationGeneration;
    loginSubmit.disabled = true;
    let loginAccepted = false;
    try {
      await loginRequest(apiFetch, loginEmail.value, loginPassword.value);
      loginAccepted = true;
      if (generation !== authenticationGeneration) return;
      if (!(await getSessionRequest(apiFetch))) {
        showLogin("NativePOS is unavailable.");
        return;
      }
      if (generation !== authenticationGeneration) return;
      loginPassword.value = "";
      await revealWorkspace(generation);
    } catch (error) {
      if (generation !== authenticationGeneration) return;
      showLogin(
        !loginAccepted && isAuthenticationError(error)
          ? "Incorrect email or password."
          : loginAccepted && isAuthenticationError(error)
            ? "Your session has ended. Please sign in again."
            : "NativePOS is unavailable.",
      );
    } finally {
      if (generation === authenticationGeneration) loginSubmit.disabled = false;
    }
  });

  logout.addEventListener("click", async () => {
    const generation = ++authenticationGeneration;
    logout.disabled = true;
    try {
      await logoutRequest(apiFetch, csrfTokenFromDocument(documentObject));
      if (generation === authenticationGeneration) showLogin();
    } catch {
      if (generation === authenticationGeneration) {
        status.textContent = "Could not sign out.";
      }
    } finally {
      if (generation === authenticationGeneration) logout.disabled = false;
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
      pageSelectionGeneration += 1;
      selectedId = result.page.id;
      selectedRevisionNumber = result.revisionNumber;
      pageTitle.value = result.page.title;
      editor.hidden = false;
      empty.hidden = true;
      showEditableBody({
        blocks: [],
        pageId: result.page.id,
        revisionNumber: 0,
      });
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

  saveBody.addEventListener("click", async () => {
    if (
      !selectedId ||
      selectedBodyRevisionNumber === null ||
      pageBody.disabled ||
      saveBody.disabled
    ) {
      return;
    }
    const id = selectedId;
    const selectionGeneration = pageSelectionGeneration;
    const revisionNumber = selectedBodyRevisionNumber;
    const blockId = selectedBodyBlockId;
    const bodyText = pageBody.value;
    pageBody.disabled = true;
    saveBody.disabled = true;
    try {
      const blockDocument = await updateBlockDocumentRequest(
        apiFetch,
        id,
        [
          {
            ...(blockId ? { id: blockId } : {}),
            blockType: "paragraph",
            clientRef: "browser-body-" + String(++bodySaveSequence),
            content: { text: bodyText },
          },
        ],
        revisionNumber,
        csrfTokenFromDocument(documentObject),
      );
      if (
        selectionGeneration !== pageSelectionGeneration ||
        selectedId !== id
      ) {
        return;
      }
      if (showEditableBody(blockDocument)) {
        bodyStatus.textContent = "Page body saved.";
      }
    } catch (error) {
      if (
        selectionGeneration !== pageSelectionGeneration ||
        selectedId !== id
      ) {
        return;
      }
      if (isAuthenticationError(error)) {
        showLogin("Your session has ended. Please sign in again.");
      } else if (error instanceof Error && error.statusCode === 409) {
        bodyStatus.textContent =
          "This page body changed. Reload the page before saving.";
      } else {
        bodyStatus.textContent = "Could not save page body.";
      }
    } finally {
      if (
        selectionGeneration === pageSelectionGeneration &&
        selectedId === id &&
        selectedBodyRevisionNumber !== null
      ) {
        pageBody.disabled = false;
        saveBody.disabled = false;
      }
    }
  });

  showLogin();
  const generation = ++authenticationGeneration;
  try {
    if (!(await getSessionRequest(apiFetch))) return;
    if (generation !== authenticationGeneration) return;
    await revealWorkspace(generation);
  } catch (error) {
    if (generation !== authenticationGeneration) return;
    if (isAuthenticationError(error)) {
      showLogin("Your session has ended. Please sign in again.");
    } else {
      showLogin("NativePOS is unavailable.");
    }
  }
}

if (typeof document !== "undefined") void startBrowserApp();
