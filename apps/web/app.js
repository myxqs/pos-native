/* global Blob, document, fetch, URL */

const MAX_PAGE_HIERARCHY_EDGES = 32;

export async function createPageRequest(
  apiFetch,
  title,
  csrfToken,
  parentId = null,
) {
  const body = { title };
  if (parentId !== null) body.parentId = parentId;
  return pageMutationFromResponse(
    await requestJson(apiFetch, "/api/v1/pages", {
      body: JSON.stringify(body),
      credentials: "same-origin",
      headers: jsonHeaders(csrfToken),
      method: "POST",
    }),
  );
}

export async function updatePageRequest(
  apiFetch,
  id,
  title,
  revisionNumber,
  csrfToken,
) {
  return pageMutationFromResponse(
    await requestJson(apiFetch, "/api/v1/pages/" + id, {
      body: JSON.stringify({ title }),
      credentials: "same-origin",
      headers: jsonHeaders(csrfToken, {
        "if-match": String(revisionNumber),
      }),
      method: "PATCH",
    }),
  );
}

export async function getPageListRequest(apiFetch, scope = "active") {
  if (scope !== "active" && scope !== "archived") {
    throw new Error("NativePOS is unavailable");
  }
  const body = await requestJson(
    apiFetch,
    scope === "archived" ? "/api/v1/pages?archived=only" : "/api/v1/pages",
    {
      credentials: "same-origin",
      method: "GET",
    },
  );
  if (!isPlainRecord(body) || !Array.isArray(body.pages)) {
    throw new Error("NativePOS is unavailable");
  }
  return body.pages.map(pageFromResponse);
}

export async function movePageRequest(
  apiFetch,
  id,
  parentId,
  revisionNumber,
  csrfToken,
) {
  return pageMutationFromResponse(
    await requestJson(apiFetch, "/api/v1/pages/" + id + "/parent", {
      body: JSON.stringify({ parentId }),
      credentials: "same-origin",
      headers: jsonHeaders(csrfToken, {
        "if-match": String(revisionNumber),
      }),
      method: "PUT",
    }),
  );
}

export async function archivePageRequest(
  apiFetch,
  id,
  revisionNumber,
  csrfToken,
) {
  return pageMutationFromResponse(
    await requestJson(apiFetch, "/api/v1/pages/" + id + "/archive", {
      body: JSON.stringify({}),
      credentials: "same-origin",
      headers: jsonHeaders(csrfToken, {
        "if-match": String(revisionNumber),
      }),
      method: "POST",
    }),
  );
}

export async function restorePageRequest(
  apiFetch,
  id,
  parentId,
  revisionNumber,
  csrfToken,
) {
  return pageMutationFromResponse(
    await requestJson(apiFetch, "/api/v1/pages/" + id + "/restore", {
      body: JSON.stringify({ parentId }),
      credentials: "same-origin",
      headers: jsonHeaders(csrfToken, {
        "if-match": String(revisionNumber),
      }),
      method: "PUT",
    }),
  );
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

export async function getDataSourcesRequest(apiFetch) {
  const body = await requestJson(
    apiFetch,
    "/api/v1/data-sources?limit=100&offset=0",
    { credentials: "same-origin", method: "GET" },
  );
  if (!isPlainRecord(body) || !Array.isArray(body.sources))
    throw new Error("NativePOS is unavailable");
  return body.sources;
}

export async function getAssetsRequest(apiFetch) {
  const body = await requestJson(apiFetch, "/api/v1/assets?limit=50", {
    credentials: "same-origin",
    method: "GET",
  });
  if (!isPlainRecord(body) || !Array.isArray(body.assets)) {
    throw new Error("NativePOS is unavailable");
  }
  return body.assets.map(assetFromResponse);
}

export async function uploadAssetRequest(apiFetch, file, csrfToken) {
  if (!(file instanceof Blob) || typeof file.name !== "string") {
    throw new Error("NativePOS is unavailable");
  }
  const body = await requestJson(apiFetch, "/api/v1/assets", {
    body: await file.arrayBuffer(),
    credentials: "same-origin",
    headers: {
      "content-type": "application/octet-stream",
      "x-nativepos-filename": encodeURIComponent(file.name),
      "x-nativepos-media-type": file.type || "application/octet-stream",
      ...csrfHeaders(csrfToken),
    },
    method: "POST",
  });
  if (!isPlainRecord(body) || !isPlainRecord(body.asset)) {
    throw new Error("NativePOS is unavailable");
  }
  return assetFromResponse(body.asset);
}

export async function downloadAssetRequest(apiFetch, id) {
  const response = await apiFetch(`/api/v1/assets/${id}/content`, {
    credentials: "same-origin",
    method: "GET",
  });
  if (!response.ok) throw createRequestError(response.status);
  return response.blob();
}

export async function getPageAssetsRequest(apiFetch, pageId) {
  const body = await requestJson(apiFetch, `/api/v1/pages/${pageId}/assets`, {
    credentials: "same-origin",
    method: "GET",
  });
  if (!isPlainRecord(body) || !Array.isArray(body.items))
    throw new Error("NativePOS is unavailable");
  return body.items.map((item) => {
    if (!isPlainRecord(item) || !isPlainRecord(item.link))
      throw new Error("NativePOS is unavailable");
    return { link: item.link, asset: assetFromResponse(item.asset) };
  });
}

export async function attachPageAssetRequest(
  apiFetch,
  pageId,
  assetId,
  csrfToken,
) {
  const body = await requestJson(
    apiFetch,
    `/api/v1/pages/${pageId}/assets/${assetId}`,
    {
      credentials: "same-origin",
      headers: csrfHeaders(csrfToken),
      method: "POST",
    },
  );
  if (!isPlainRecord(body) || !isPlainRecord(body.link))
    throw new Error("NativePOS is unavailable");
  return body.link;
}

export async function unlinkPageAssetRequest(
  apiFetch,
  pageId,
  assetId,
  csrfToken,
) {
  const body = await requestJson(
    apiFetch,
    `/api/v1/pages/${pageId}/assets/${assetId}`,
    {
      credentials: "same-origin",
      headers: csrfHeaders(csrfToken),
      method: "DELETE",
    },
  );
  if (!isPlainRecord(body) || !isPlainRecord(body.link))
    throw new Error("NativePOS is unavailable");
  return body.link;
}

export async function createDataSourceRequest(apiFetch, name, csrfToken) {
  const body = await requestJson(apiFetch, "/api/v1/data-sources", {
    body: JSON.stringify({ name }),
    credentials: "same-origin",
    headers: jsonHeaders(csrfToken),
    method: "POST",
  });
  if (!isPlainRecord(body) || !isPlainRecord(body.source))
    throw new Error("NativePOS is unavailable");
  return body.source;
}

export async function getDefinitionsRequest(apiFetch, sourceId) {
  const body = await requestJson(
    apiFetch,
    `/api/v1/data-sources/${sourceId}/definitions`,
    { credentials: "same-origin", method: "GET" },
  );
  if (!isPlainRecord(body) || !Array.isArray(body.definitions))
    throw new Error("NativePOS is unavailable");
  return body.definitions;
}

export async function createDefinitionRequest(
  apiFetch,
  sourceId,
  definition,
  csrfToken,
) {
  const body = await requestJson(
    apiFetch,
    `/api/v1/data-sources/${sourceId}/definitions`,
    {
      body: JSON.stringify(definition),
      credentials: "same-origin",
      headers: jsonHeaders(csrfToken),
      method: "POST",
    },
  );
  if (!isPlainRecord(body) || !isPlainRecord(body.definition))
    throw new Error("NativePOS is unavailable");
  return body.definition;
}

export async function getRecordsRequest(apiFetch, sourceId) {
  const body = await requestJson(
    apiFetch,
    `/api/v1/data-sources/${sourceId}/items?limit=100&offset=0`,
    { credentials: "same-origin", method: "GET" },
  );
  if (!isPlainRecord(body) || !Array.isArray(body.records))
    throw new Error("NativePOS is unavailable");
  return body.records;
}

export async function createRecordRequest(
  apiFetch,
  sourceId,
  title,
  csrfToken,
) {
  return recordFromResponse(
    await requestJson(apiFetch, `/api/v1/data-sources/${sourceId}/items`, {
      body: JSON.stringify({ title }),
      credentials: "same-origin",
      headers: jsonHeaders(csrfToken),
      method: "POST",
    }),
  );
}

export async function getRecordRequest(apiFetch, recordId) {
  return recordFromResponse(
    await requestJson(apiFetch, `/api/v1/records/${recordId}`, {
      credentials: "same-origin",
      method: "GET",
    }),
  );
}

export async function setRecordPropertyRequest(
  apiFetch,
  recordId,
  definitionId,
  value,
  revisionNumber,
  csrfToken,
) {
  return recordFromResponse(
    await requestJson(
      apiFetch,
      `/api/v1/records/${recordId}/properties/${definitionId}`,
      {
        body: JSON.stringify({ value }),
        credentials: "same-origin",
        headers: jsonHeaders(csrfToken, {
          "if-match": `"${revisionNumber}"`,
        }),
        method: "PUT",
      },
    ),
  );
}

export async function addRecordRelationRequest(
  apiFetch,
  recordId,
  definitionId,
  targetRecordId,
  revisionNumber,
  csrfToken,
) {
  return recordFromResponse(
    await requestJson(
      apiFetch,
      `/api/v1/records/${recordId}/relations/${definitionId}`,
      {
        body: JSON.stringify({ targetRecordId }),
        credentials: "same-origin",
        headers: jsonHeaders(csrfToken, {
          "if-match": `"${revisionNumber}"`,
        }),
        method: "POST",
      },
    ),
  );
}

export async function removeRecordRelationRequest(
  apiFetch,
  edgeId,
  revisionNumber,
  csrfToken,
) {
  return recordFromResponse(
    await requestJson(apiFetch, `/api/v1/relations/${edgeId}`, {
      credentials: "same-origin",
      headers: csrfHeaders(csrfToken, {
        "if-match": `"${revisionNumber}"`,
      }),
      method: "DELETE",
    }),
  );
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

export function pageTreeFromPages(pages, scope = "active", knownPages = []) {
  if (
    !Array.isArray(pages) ||
    !Array.isArray(knownPages) ||
    (scope !== "active" && scope !== "archived")
  ) {
    throw new Error("NativePOS is unavailable");
  }

  const visiblePages = pages.map(pageFromResponse);
  const known = knownPages.map(pageFromResponse);
  const pageById = new Map();
  for (const page of [...known, ...visiblePages]) {
    if (pageById.has(page.id)) throw new Error("NativePOS is unavailable");
    pageById.set(page.id, page);
  }
  if (scope === "active") {
    if (
      known.length !== 0 ||
      visiblePages.some((page) => page.archivedAt !== null)
    ) {
      throw new Error("NativePOS is unavailable");
    }
  } else if (
    known.some((page) => page.archivedAt !== null) ||
    visiblePages.some((page) => page.archivedAt === null)
  ) {
    throw new Error("NativePOS is unavailable");
  }

  for (const page of pageById.values()) {
    let current = page;
    let edges = 0;
    const visited = new Set([page.id]);
    while (current.parentId !== null) {
      edges += 1;
      if (edges > MAX_PAGE_HIERARCHY_EDGES) {
        throw new Error("NativePOS is unavailable");
      }
      const parent = pageById.get(current.parentId);
      if (!parent || visited.has(parent.id)) {
        throw new Error("NativePOS is unavailable");
      }
      visited.add(parent.id);
      current = parent;
    }
  }

  const nodes = new Map(
    visiblePages.map((page) => [page.id, { children: [], page }]),
  );
  const roots = [];
  for (const page of visiblePages) {
    const node = nodes.get(page.id);
    if (!node) throw new Error("NativePOS is unavailable");
    if (page.parentId === null) {
      roots.push(node);
      continue;
    }
    const parentNode = nodes.get(page.parentId);
    if (parentNode) {
      parentNode.children.push(node);
      continue;
    }
    if (!pageById.has(page.parentId)) {
      throw new Error("NativePOS is unavailable");
    }
    roots.push(node);
  }

  const breadcrumbs = new Map();
  for (const page of pageById.values()) {
    const items = [];
    let current = page;
    while (current) {
      items.unshift(current);
      current =
        current.parentId === null ? null : pageById.get(current.parentId);
      if (!current && items[0]?.parentId !== null) {
        throw new Error("NativePOS is unavailable");
      }
    }
    breadcrumbs.set(page.id, items);
  }

  return { breadcrumbs, roots };
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

function pageFromResponse(value) {
  if (
    !isPlainRecord(value) ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    typeof value.title !== "string" ||
    (value.parentId !== null &&
      (typeof value.parentId !== "string" || value.parentId.length === 0)) ||
    (value.archivedAt !== null &&
      (typeof value.archivedAt !== "string" || value.archivedAt.length === 0))
  ) {
    throw new Error("NativePOS is unavailable");
  }
  return {
    archivedAt: value.archivedAt,
    id: value.id,
    parentId: value.parentId,
    title: value.title,
  };
}

function pageMutationFromResponse(value) {
  if (
    !isPlainRecord(value) ||
    !Number.isSafeInteger(value.revisionNumber) ||
    value.revisionNumber < 1
  ) {
    throw new Error("NativePOS is unavailable");
  }
  return {
    page: pageFromResponse(value.page),
    revisionNumber: value.revisionNumber,
  };
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

function recordFromResponse(value) {
  if (
    !isPlainRecord(value) ||
    !isPlainRecord(value.record) ||
    !isPlainRecord(value.record.item) ||
    !isPlainRecord(value.record.page) ||
    !Number.isSafeInteger(value.record.propertyRevisionNumber) ||
    value.record.propertyRevisionNumber < 1
  ) {
    throw new Error("NativePOS is unavailable");
  }
  return {
    ...value.record,
    outgoing: Array.isArray(value.outgoing) ? value.outgoing : [],
  };
}

function assetFromResponse(value) {
  if (
    !isPlainRecord(value) ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    typeof value.originalFilename !== "string" ||
    value.originalFilename.length === 0 ||
    typeof value.mimeType !== "string" ||
    value.mimeType.length === 0 ||
    !Number.isSafeInteger(value.byteSize) ||
    value.byteSize < 0 ||
    typeof value.createdAt !== "string" ||
    value.createdAt.length === 0
  ) {
    throw new Error("NativePOS is unavailable");
  }
  return {
    id: value.id,
    originalFilename: value.originalFilename,
    mimeType: value.mimeType,
    byteSize: value.byteSize,
    createdAt: value.createdAt,
  };
}

function initializeAssetBrowser(documentObject, apiFetch, callbacks) {
  const list = documentObject.querySelector("#asset-list");
  if (!list) return { refresh: async () => {}, reset: () => {} };
  const fileInput = requiredElement(documentObject, "#asset-file");
  const upload = requiredElement(documentObject, "#upload-asset");
  const status = requiredElement(documentObject, "#asset-status");
  const linkedList = documentObject.querySelector("#page-asset-list");
  const refreshLinkedButton = documentObject.querySelector(
    "#refresh-page-assets",
  );
  let generation = 0;
  let pending = false;
  let pendingToken = null;

  function applyPending() {
    fileInput.disabled = pending;
    upload.disabled = pending;
  }

  function handleError(error, fallback) {
    if (isAuthenticationError(error)) callbacks.onAuthenticationError();
    else status.textContent = fallback;
  }

  function render(assets) {
    list.replaceChildren(
      ...assets.map((asset) => {
        const item = documentObject.createElement("li");
        const metadata = documentObject.createElement("span");
        metadata.textContent = `${asset.originalFilename} — ${asset.mimeType} — ${asset.byteSize} bytes`;
        const button = documentObject.createElement("button");
        button.type = "button";
        button.textContent = "Download";
        button.addEventListener("click", async () => {
          try {
            const blob = await downloadAssetRequest(apiFetch, asset.id);
            const objectUrl = URL.createObjectURL(blob);
            try {
              const anchor = documentObject.createElement("a");
              anchor.href = objectUrl;
              anchor.download = asset.originalFilename;
              anchor.click();
            } finally {
              URL.revokeObjectURL(objectUrl);
            }
          } catch (error) {
            handleError(error, "Could not download asset.");
          }
        });
        item.append(metadata);
        item.append(button);
        const attach = documentObject.createElement("button");
        attach.type = "button";
        attach.textContent = "Attach to selected page";
        attach.addEventListener("click", async () => {
          const pageId = callbacks.selectedPageId();
          if (!pageId) {
            status.textContent = "Select a page first.";
            return;
          }
          try {
            await attachPageAssetRequest(
              apiFetch,
              pageId,
              asset.id,
              callbacks.csrfToken(),
            );
            status.textContent = "Asset attached to page.";
            await refreshLinked();
          } catch (error) {
            handleError(error, "Could not attach asset.");
          }
        });
        item.append(attach);
        return item;
      }),
    );
  }

  async function refreshLinked() {
    if (!linkedList) return;
    const pageId = callbacks.selectedPageId();
    if (!pageId) {
      linkedList.replaceChildren();
      return;
    }
    try {
      const items = await getPageAssetsRequest(apiFetch, pageId);
      if (callbacks.selectedPageId() !== pageId) return;
      linkedList.replaceChildren(
        ...items.map(({ asset }) => {
          const item = documentObject.createElement("li");
          const metadata = documentObject.createElement("span");
          metadata.textContent = `${asset.originalFilename} — ${asset.mimeType} — ${asset.byteSize} bytes`;
          const unlink = documentObject.createElement("button");
          unlink.type = "button";
          unlink.textContent = "Unlink";
          unlink.addEventListener("click", async () => {
            try {
              await unlinkPageAssetRequest(
                apiFetch,
                pageId,
                asset.id,
                callbacks.csrfToken(),
              );
              status.textContent = "Asset unlinked from page.";
              await refreshLinked();
            } catch (error) {
              handleError(error, "Could not unlink asset.");
            }
          });
          item.append(metadata);
          item.append(unlink);
          return item;
        }),
      );
    } catch (error) {
      handleError(error, "Could not load linked assets.");
    }
  }

  async function refresh() {
    const requestGeneration = ++generation;
    try {
      const assets = await getAssetsRequest(apiFetch);
      if (requestGeneration !== generation) return;
      render(assets);
      status.textContent = "";
    } catch (error) {
      if (requestGeneration !== generation) return;
      handleError(error, "Could not load assets.");
    }
  }

  function reset() {
    generation += 1;
    pending = false;
    pendingToken = null;
    applyPending();
    list.replaceChildren();
    linkedList?.replaceChildren();
    status.textContent = "";
  }

  upload.addEventListener("click", async () => {
    const file = fileInput.files?.[0];
    if (!file || pending) return;
    const requestGeneration = generation;
    const token = {};
    pendingToken = token;
    pending = true;
    applyPending();
    try {
      await uploadAssetRequest(apiFetch, file, callbacks.csrfToken());
      if (requestGeneration !== generation) return;
      status.textContent = "Asset uploaded.";
      await refresh();
    } catch (error) {
      if (requestGeneration !== generation) return;
      handleError(error, "Could not upload asset.");
    } finally {
      if (pendingToken === token) {
        pending = false;
        pendingToken = null;
        applyPending();
      }
    }
  });
  refreshLinkedButton?.addEventListener("click", refreshLinked);

  return { refresh, refreshLinked, reset };
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

function initializeCollectionBrowser(documentObject, apiFetch, callbacks) {
  const sourceList = documentObject.querySelector("#data-source-list");
  if (!sourceList) return { refresh: async () => {}, reset: () => {} };
  const sourceForm = requiredElement(documentObject, "#create-data-source");
  const sourceName = requiredElement(documentObject, "#new-data-source-name");
  const panel = requiredElement(documentObject, "#collection-panel");
  const collectionName = requiredElement(documentObject, "#collection-name");
  const definitionForm = requiredElement(
    documentObject,
    "#create-property-definition",
  );
  const definitionName = requiredElement(documentObject, "#new-property-name");
  const definitionKind = requiredElement(documentObject, "#new-property-kind");
  const definitionOptions = requiredElement(
    documentObject,
    "#new-property-options",
  );
  const definitionTarget = requiredElement(
    documentObject,
    "#new-property-target",
  );
  const recordForm = requiredElement(documentObject, "#create-record");
  const recordTitleInput = requiredElement(documentObject, "#new-record-title");
  const recordList = requiredElement(documentObject, "#record-list");
  const inspector = requiredElement(documentObject, "#record-inspector");
  const recordTitle = requiredElement(documentObject, "#record-title");
  const openRecordPage = requiredElement(documentObject, "#open-record-page");
  const propertyForm = requiredElement(documentObject, "#set-record-property");
  const propertyDefinition = requiredElement(
    documentObject,
    "#record-property-definition",
  );
  const propertyValue = requiredElement(
    documentObject,
    "#record-property-value",
  );
  const relationForm = requiredElement(documentObject, "#add-record-relation");
  const relationDefinition = requiredElement(
    documentObject,
    "#record-relation-definition",
  );
  const relationTarget = requiredElement(
    documentObject,
    "#record-relation-target",
  );
  const relationList = requiredElement(documentObject, "#record-relation-list");
  const recordRevision = requiredElement(documentObject, "#record-revision");
  const status = requiredElement(documentObject, "#collection-status");
  let selectedSource = null;
  let definitions = [];
  let selectedRecord = null;

  function handleError(error, fallback) {
    if (isAuthenticationError(error)) callbacks.onAuthenticationError();
    else status.textContent = fallback;
  }

  function renderRecord(record) {
    selectedRecord = record;
    inspector.hidden = false;
    recordTitle.textContent = record.page.title;
    recordRevision.textContent = `Property revision ${record.propertyRevisionNumber}`;
    relationList.replaceChildren(
      ...record.outgoing.map((edge) => {
        const item = documentObject.createElement("li");
        const button = documentObject.createElement("button");
        button.type = "button";
        button.textContent = `Remove relation to ${edge.targetRecordId}`;
        button.addEventListener("click", async () => {
          try {
            await removeRecordRelationRequest(
              apiFetch,
              edge.id,
              selectedRecord.propertyRevisionNumber,
              callbacks.csrfToken(),
            );
            await selectRecord(selectedRecord.item.id);
            status.textContent = "Relation removed.";
          } catch (error) {
            await handleRecordMutationError(
              error,
              "Could not remove relation.",
            );
          }
        });
        item.append(button);
        return item;
      }),
    );
  }

  async function selectRecord(id) {
    try {
      renderRecord(await getRecordRequest(apiFetch, id));
      status.textContent = "";
    } catch (error) {
      handleError(error, "Could not load record.");
    }
  }

  async function loadSelectedSource() {
    if (!selectedSource) return;
    const [nextDefinitions, records] = await Promise.all([
      getDefinitionsRequest(apiFetch, selectedSource.id),
      getRecordsRequest(apiFetch, selectedSource.id),
    ]);
    definitions = nextDefinitions;
    propertyDefinition.replaceChildren(
      ...definitions
        .filter((definition) => definition.kind !== "relation")
        .map((definition) => {
          const option = documentObject.createElement("option");
          option.value = definition.id;
          option.textContent = definition.name;
          return option;
        }),
    );
    relationDefinition.replaceChildren(
      ...definitions
        .filter((definition) => definition.kind === "relation")
        .map((definition) => {
          const option = documentObject.createElement("option");
          option.value = definition.id;
          option.textContent = definition.name;
          return option;
        }),
    );
    recordList.replaceChildren(
      ...records.map((record) => {
        const item = documentObject.createElement("li");
        const button = documentObject.createElement("button");
        button.type = "button";
        button.textContent = record.page.title;
        button.addEventListener("click", () => selectRecord(record.item.id));
        item.append(button);
        return item;
      }),
    );
  }

  async function selectSource(source) {
    callbacks.onSelectSource();
    selectedSource = source;
    selectedRecord = null;
    inspector.hidden = true;
    panel.hidden = false;
    collectionName.textContent = source.name;
    try {
      await loadSelectedSource();
      status.textContent = "";
    } catch (error) {
      handleError(error, "Could not load collection.");
    }
  }

  async function refresh() {
    const sources = await getDataSourcesRequest(apiFetch);
    sourceList.replaceChildren(
      ...sources.map((source) => {
        const item = documentObject.createElement("li");
        const button = documentObject.createElement("button");
        button.type = "button";
        button.textContent = source.name;
        button.addEventListener("click", () => selectSource(source));
        item.append(button);
        return item;
      }),
    );
  }

  function reset() {
    selectedSource = null;
    selectedRecord = null;
    definitions = [];
    sourceList.replaceChildren();
    recordList.replaceChildren();
    inspector.hidden = true;
    panel.hidden = true;
    status.textContent = "";
  }

  sourceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const source = await createDataSourceRequest(
        apiFetch,
        sourceName.value,
        callbacks.csrfToken(),
      );
      sourceName.value = "";
      await refresh();
      await selectSource(source);
    } catch (error) {
      handleError(error, "Could not create collection.");
    }
  });

  definitionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selectedSource) return;
    const definition = {
      name: definitionName.value,
      kind: definitionKind.value,
    };
    if (definition.kind === "status") {
      definition.options = definitionOptions.value
        .split(",")
        .map((option) => option.trim())
        .filter(Boolean);
    }
    if (definition.kind === "relation") {
      definition.targetSourceId = definitionTarget.value;
    }
    try {
      await createDefinitionRequest(
        apiFetch,
        selectedSource.id,
        definition,
        callbacks.csrfToken(),
      );
      definitionName.value = "";
      await loadSelectedSource();
      status.textContent = "Field created.";
    } catch (error) {
      handleError(error, "Could not create field.");
    }
  });

  recordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selectedSource) return;
    try {
      const record = await createRecordRequest(
        apiFetch,
        selectedSource.id,
        recordTitleInput.value,
        callbacks.csrfToken(),
      );
      recordTitleInput.value = "";
      await Promise.all([loadSelectedSource(), callbacks.onRecordCreated()]);
      renderRecord(record);
      status.textContent = "Record created.";
    } catch (error) {
      handleError(error, "Could not create record.");
    }
  });

  propertyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selectedRecord || !propertyDefinition.value) return;
    const definition = definitions.find(
      (entry) => entry.id === propertyDefinition.value,
    );
    const value =
      definition?.kind === "checkbox"
        ? propertyValue.value.toLowerCase() === "true"
        : propertyValue.value;
    try {
      renderRecord(
        await setRecordPropertyRequest(
          apiFetch,
          selectedRecord.item.id,
          propertyDefinition.value,
          value,
          selectedRecord.propertyRevisionNumber,
          callbacks.csrfToken(),
        ),
      );
      status.textContent = "Value saved.";
    } catch (error) {
      await handleRecordMutationError(error, "Could not save value.");
    }
  });

  async function handleRecordMutationError(error, fallback) {
    if (error instanceof Error && error.statusCode === 409 && selectedRecord) {
      await selectRecord(selectedRecord.item.id);
      status.textContent =
        "This record changed. Review it before saving again.";
    } else {
      handleError(error, fallback);
    }
  }

  relationForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selectedRecord || !relationDefinition.value) return;
    try {
      await addRecordRelationRequest(
        apiFetch,
        selectedRecord.item.id,
        relationDefinition.value,
        relationTarget.value,
        selectedRecord.propertyRevisionNumber,
        callbacks.csrfToken(),
      );
      relationTarget.value = "";
      await selectRecord(selectedRecord.item.id);
      status.textContent = "Relation added.";
    } catch (error) {
      await handleRecordMutationError(error, "Could not add relation.");
    }
  });

  openRecordPage.addEventListener("click", async () => {
    if (selectedRecord) {
      panel.hidden = true;
      await callbacks.onOpenPage(selectedRecord.item.id);
    }
  });

  return { refresh, reset };
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
  const childForm = requiredElement(documentObject, "#create-child-page");
  const childTitle = requiredElement(documentObject, "#new-child-page-title");
  const pageTitle = requiredElement(documentObject, "#page-title");
  const save = requiredElement(documentObject, "#save-page");
  const breadcrumbs = requiredElement(documentObject, "#breadcrumbs");
  const pageParent = requiredElement(documentObject, "#page-parent");
  const saveParent = requiredElement(documentObject, "#save-parent");
  const archivePage = requiredElement(documentObject, "#archive-page");
  const restorePage = requiredElement(documentObject, "#restore-page");
  const pageBody = requiredElement(documentObject, "#page-body");
  const saveBody = requiredElement(documentObject, "#save-body");
  const bodyStatus = requiredElement(documentObject, "#body-status");
  const list = requiredElement(documentObject, "#page-list");
  const showArchivedPages = requiredElement(
    documentObject,
    "#show-archived-pages",
  );
  const archivedPagesPanel = requiredElement(documentObject, "#archived-pages");
  const archivedList = requiredElement(documentObject, "#archived-page-list");
  const editor = requiredElement(documentObject, "#editor");
  const empty = requiredElement(documentObject, "#empty-state");
  const status = requiredElement(documentObject, "#status");
  let selectedPage = null;
  let selectedRevisionNumber = null;
  let selectedBodyRevisionNumber = null;
  let selectedBodyBlockId = null;
  let activePages = [];
  let archivedPages = [];
  let authenticationGeneration = 0;
  let pageSelectionGeneration = 0;
  let activeListGeneration = 0;
  let archivedListGeneration = 0;
  let bodySaveSequence = 0;
  let bodySavePending = false;
  let pageSavePendingId = null;
  let childCreatePendingParentId = null;
  let rootCreatePending = false;
  let movePendingId = null;
  let archivePendingId = null;
  let restorePendingId = null;
  let archivedListPending = false;
  let archivedPendingGeneration = null;
  let refreshCollections = async () => {};
  let resetCollections = () => {};
  let refreshAssets = async () => {};
  let resetAssets = () => {};

  function isArchivedSelection() {
    return selectedPage?.archivedAt !== null && selectedPage !== null;
  }

  function isLiveSelection() {
    return selectedPage?.archivedAt === null;
  }

  function mutationAppliesToSelection(id, selectionGeneration) {
    return (
      selectionGeneration === pageSelectionGeneration && selectedPage?.id === id
    );
  }

  function resetBodyEditor() {
    selectedBodyRevisionNumber = null;
    selectedBodyBlockId = null;
    bodySavePending = false;
    pageBody.value = "";
    pageBody.disabled = true;
    saveBody.disabled = true;
    bodyStatus.textContent = "";
  }

  function applyBodyEditability() {
    const editable =
      selectedBodyRevisionNumber !== null &&
      !isArchivedSelection() &&
      !bodySavePending;
    pageBody.disabled = !editable;
    saveBody.disabled = !editable;
  }

  function showEditableBody(blockDocument) {
    const paragraph = editableParagraph(blockDocument);
    if (!paragraph) {
      resetBodyEditor();
      bodyStatus.textContent =
        "This page body cannot be edited in this version.";
      return false;
    }
    selectedBodyRevisionNumber = paragraph.revisionNumber;
    selectedBodyBlockId = paragraph.blockId;
    bodySavePending = false;
    pageBody.value = paragraph.text;
    applyBodyEditability();
    bodyStatus.textContent = "";
    return true;
  }

  function replacePage(pages, page) {
    return [...pages.filter((candidate) => candidate.id !== page.id), page];
  }

  function selectedHierarchyFor(page) {
    if (page.archivedAt === null) {
      return pageTreeFromPages(replacePage(activePages, page), "active");
    }
    return pageTreeFromPages(
      replacePage(archivedPages, page),
      "archived",
      activePages.filter((candidate) => candidate.id !== page.id),
    );
  }

  function descendantsOf(node) {
    const result = new Set([node.page.id]);
    for (const child of node.children) {
      for (const id of descendantsOf(child)) result.add(id);
    }
    return result;
  }

  function selectedNode(nodes, id) {
    for (const node of nodes) {
      if (node.page.id === id) return node;
      const match = selectedNode(node.children, id);
      if (match) return match;
    }
    return null;
  }

  function populateParentSelector(hierarchy) {
    pageParent.replaceChildren();
    const rootOption = documentObject.createElement("option");
    rootOption.textContent = "Root page";
    rootOption.value = "";
    pageParent.append(rootOption);
    const currentNode = selectedPage
      ? selectedNode(hierarchy.roots, selectedPage.id)
      : null;
    const excluded = currentNode ? descendantsOf(currentNode) : new Set();
    for (const candidate of activePages) {
      if (excluded.has(candidate.id)) continue;
      const option = documentObject.createElement("option");
      option.textContent = candidate.title;
      option.value = candidate.id;
      pageParent.append(option);
    }
    pageParent.value = selectedPage?.parentId ?? "";
  }

  function applySelectionControls() {
    const live = isLiveSelection();
    const archived = isArchivedSelection();
    const selectedId = selectedPage?.id;
    pageTitle.disabled = !live || pageSavePendingId === selectedId;
    save.disabled = !live || pageSavePendingId === selectedId;
    childTitle.disabled = !live || childCreatePendingParentId === selectedId;
    pageParent.disabled =
      selectedPage === null ||
      movePendingId === selectedId ||
      restorePendingId === selectedId;
    saveParent.disabled = !live || movePendingId === selectedId;
    archivePage.hidden = !live;
    archivePage.disabled = !live || archivePendingId === selectedId;
    restorePage.hidden = !archived;
    restorePage.disabled = !archived || restorePendingId === selectedId;
    applyBodyEditability();
  }

  function showSelectedPage(
    page,
    revisionNumber,
    { preserveParentDraft = false, preserveTitleDraft = false } = {},
  ) {
    const titleDraft = pageTitle.value;
    const parentDraft = pageParent.value;
    selectedPage = page;
    selectedRevisionNumber = revisionNumber;
    pageTitle.value = preserveTitleDraft ? titleDraft : page.title;
    const hierarchy = selectedHierarchyFor(page);
    const path = hierarchy.breadcrumbs.get(page.id);
    if (!path) throw new Error("NativePOS is unavailable");
    breadcrumbs.textContent = path.map((item) => item.title).join(" / ");
    populateParentSelector(hierarchy);
    if (preserveParentDraft) pageParent.value = parentDraft;
    editor.hidden = false;
    empty.hidden = true;
    applySelectionControls();
  }

  function renderPageTree(target, hierarchy) {
    function renderNodes(nodes) {
      return nodes.map((node) => {
        const item = documentObject.createElement("li");
        const button = documentObject.createElement("button");
        button.type = "button";
        button.textContent = node.page.title;
        button.addEventListener("click", async () => {
          await selectPage(node.page.id);
        });
        item.append(button);
        if (node.children.length > 0) {
          const childList = documentObject.createElement("ul");
          childList.replaceChildren(...renderNodes(node.children));
          item.append(childList);
        }
        return item;
      });
    }
    target.replaceChildren(...renderNodes(hierarchy.roots));
  }

  function clearNavigation() {
    activePages = [];
    archivedPages = [];
    archivedListPending = false;
    archivedPendingGeneration = null;
    list.replaceChildren();
    archivedList.replaceChildren();
    archivedPagesPanel.hidden = true;
  }

  function showLogin(message = "") {
    pageSelectionGeneration += 1;
    activeListGeneration += 1;
    archivedListGeneration += 1;
    loginPanel.hidden = false;
    workspace.hidden = true;
    loginStatus.textContent = message;
    selectedPage = null;
    selectedRevisionNumber = null;
    pageSavePendingId = null;
    childCreatePendingParentId = null;
    movePendingId = null;
    archivePendingId = null;
    restorePendingId = null;
    breadcrumbs.textContent = "";
    pageParent.replaceChildren();
    resetBodyEditor();
    clearNavigation();
    resetCollections();
    resetAssets();
    editor.hidden = true;
    empty.hidden = false;
    applySelectionControls();
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

  async function refreshActivePages() {
    const generation = ++activeListGeneration;
    const pages = await getPageListRequest(apiFetch, "active");
    const hierarchy = pageTreeFromPages(pages, "active");
    if (generation !== activeListGeneration) return false;
    activePages = pages;
    renderPageTree(list, hierarchy);
    return true;
  }

  async function loadArchivedPages() {
    if (archivedListPending) return;
    const generation = ++archivedListGeneration;
    archivedListPending = true;
    archivedPendingGeneration = generation;
    showArchivedPages.disabled = true;
    archivedPagesPanel.hidden = false;
    try {
      const pages = await getPageListRequest(apiFetch, "archived");
      const hierarchy = pageTreeFromPages(pages, "archived", activePages);
      if (generation !== archivedListGeneration) return;
      archivedPages = pages;
      renderPageTree(archivedList, hierarchy);
    } catch (error) {
      if (generation !== archivedListGeneration) return;
      handleWorkspaceFailure(error, "Could not load archived pages.");
    } finally {
      if (archivedPendingGeneration === generation) {
        archivedListPending = false;
        archivedPendingGeneration = null;
        showArchivedPages.disabled = false;
      }
    }
  }

  async function selectPage(id) {
    const collectionPanel = documentObject.querySelector("#collection-panel");
    if (collectionPanel) collectionPanel.hidden = true;
    const selectionGeneration = ++pageSelectionGeneration;
    archivedListGeneration += 1;
    let metadataLoaded = false;
    selectedPage = null;
    selectedRevisionNumber = null;
    breadcrumbs.textContent = "";
    resetBodyEditor();
    editor.hidden = true;
    empty.hidden = false;
    applySelectionControls();
    try {
      const result = pageMutationFromResponse(
        await requestJson(apiFetch, "/api/v1/pages/" + id, {
          credentials: "same-origin",
          method: "GET",
        }),
      );
      if (selectionGeneration !== pageSelectionGeneration) return;
      metadataLoaded = true;
      showSelectedPage(result.page, result.revisionNumber);

      const blockDocument = await getBlockDocumentRequest(
        apiFetch,
        result.page.id,
      );
      if (selectionGeneration !== pageSelectionGeneration) return;
      showEditableBody(blockDocument);
      applySelectionControls();
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

  async function refreshArchivedIfVisible() {
    if (!archivedPagesPanel.hidden) await loadArchivedPages();
  }

  ({ refresh: refreshCollections, reset: resetCollections } =
    initializeCollectionBrowser(documentObject, apiFetch, {
      csrfToken: () => csrfTokenFromDocument(documentObject),
      onAuthenticationError: () =>
        showLogin("Your session has ended. Please sign in again."),
      onRecordCreated: refreshActivePages,
      onOpenPage: selectPage,
      onSelectSource: () => {
        pageSelectionGeneration += 1;
        selectedPage = null;
        selectedRevisionNumber = null;
        editor.hidden = true;
        empty.hidden = true;
      },
    }));

  ({ refresh: refreshAssets, reset: resetAssets } = initializeAssetBrowser(
    documentObject,
    apiFetch,
    {
      csrfToken: () => csrfTokenFromDocument(documentObject),
      selectedPageId: () => selectedPage?.id ?? null,
      onAuthenticationError: () =>
        showLogin("Your session has ended. Please sign in again."),
    },
  ));

  async function revealWorkspace(generation) {
    await Promise.all([
      refreshActivePages(),
      refreshCollections(),
      refreshAssets(),
    ]);
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
    if (rootCreatePending || newTitle.disabled) return;
    const selectionGeneration = pageSelectionGeneration;
    const authenticationAtStart = authenticationGeneration;
    rootCreatePending = true;
    newTitle.disabled = true;
    try {
      const result = await createPageRequest(
        apiFetch,
        newTitle.value,
        csrfTokenFromDocument(documentObject),
      );
      if (authenticationAtStart !== authenticationGeneration) return;
      newTitle.value = "";
      if (selectionGeneration === pageSelectionGeneration) {
        pageSelectionGeneration += 1;
        showSelectedPage(result.page, result.revisionNumber);
        showEditableBody({
          blocks: [],
          pageId: result.page.id,
          revisionNumber: 0,
        });
        status.textContent = "Page created.";
      }
      await refreshActivePages();
    } catch (error) {
      handleWorkspaceFailure(error, "Could not create page.");
    } finally {
      rootCreatePending = false;
      newTitle.disabled = false;
      applySelectionControls();
    }
  });

  childForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (
      !isLiveSelection() ||
      childCreatePendingParentId === selectedPage.id ||
      childTitle.disabled
    ) {
      return;
    }
    const parentId = selectedPage.id;
    const selectionGeneration = pageSelectionGeneration;
    childCreatePendingParentId = parentId;
    applySelectionControls();
    try {
      const result = await createPageRequest(
        apiFetch,
        childTitle.value,
        csrfTokenFromDocument(documentObject),
        parentId,
      );
      if (
        selectionGeneration !== pageSelectionGeneration ||
        !isLiveSelection()
      ) {
        await refreshActivePages();
        return;
      }
      childTitle.value = "";
      pageSelectionGeneration += 1;
      showSelectedPage(result.page, result.revisionNumber);
      showEditableBody({
        blocks: [],
        pageId: result.page.id,
        revisionNumber: 0,
      });
      status.textContent = "Child page created.";
      await refreshActivePages();
    } catch (error) {
      handleWorkspaceFailure(error, "Could not create child page.");
    } finally {
      if (childCreatePendingParentId === parentId) {
        childCreatePendingParentId = null;
      }
      applySelectionControls();
    }
  });

  save.addEventListener("click", async () => {
    if (
      !isLiveSelection() ||
      selectedRevisionNumber === null ||
      pageSavePendingId === selectedPage.id
    ) {
      return;
    }
    const id = selectedPage.id;
    const revisionNumber = selectedRevisionNumber;
    const selectionGeneration = pageSelectionGeneration;
    const authenticationAtStart = authenticationGeneration;
    pageSavePendingId = id;
    applySelectionControls();
    try {
      const result = await updatePageRequest(
        apiFetch,
        id,
        pageTitle.value,
        revisionNumber,
        csrfTokenFromDocument(documentObject),
      );
      if (authenticationAtStart !== authenticationGeneration) return;
      if (mutationAppliesToSelection(id, selectionGeneration)) {
        showSelectedPage(result.page, result.revisionNumber, {
          preserveParentDraft: true,
        });
        status.textContent = "Page saved.";
      }
      await refreshActivePages();
      if (authenticationAtStart !== authenticationGeneration) return;
    } catch (error) {
      if (authenticationAtStart !== authenticationGeneration) {
        return;
      } else if (isAuthenticationError(error)) {
        showLogin("Your session has ended. Please sign in again.");
      } else if (!mutationAppliesToSelection(id, selectionGeneration)) {
        return;
      } else if (error instanceof Error && error.statusCode === 409) {
        status.textContent =
          "This page changed. Reload the page before saving.";
      } else {
        status.textContent = "Could not save page.";
      }
    } finally {
      if (pageSavePendingId === id) pageSavePendingId = null;
      applySelectionControls();
    }
  });

  saveParent.addEventListener("click", async () => {
    if (
      !isLiveSelection() ||
      selectedRevisionNumber === null ||
      movePendingId === selectedPage.id
    )
      return;
    const id = selectedPage.id;
    const revisionNumber = selectedRevisionNumber;
    const selectionGeneration = pageSelectionGeneration;
    const authenticationAtStart = authenticationGeneration;
    const parentId = pageParent.value || null;
    movePendingId = id;
    applySelectionControls();
    try {
      const result = await movePageRequest(
        apiFetch,
        id,
        parentId,
        revisionNumber,
        csrfTokenFromDocument(documentObject),
      );
      if (authenticationAtStart !== authenticationGeneration) return;
      if (mutationAppliesToSelection(id, selectionGeneration)) {
        showSelectedPage(result.page, result.revisionNumber, {
          preserveTitleDraft: true,
        });
        status.textContent = "Page moved.";
      }
      await refreshActivePages();
      if (authenticationAtStart !== authenticationGeneration) return;
    } catch (error) {
      if (authenticationAtStart !== authenticationGeneration) {
        return;
      } else if (isAuthenticationError(error)) {
        showLogin("Your session has ended. Please sign in again.");
      } else if (!mutationAppliesToSelection(id, selectionGeneration)) {
        return;
      } else if (error instanceof Error && error.statusCode === 409) {
        status.textContent =
          "This page changed. Reload the page before moving it.";
      } else {
        status.textContent = "Could not move page.";
      }
    } finally {
      if (movePendingId === id) movePendingId = null;
      applySelectionControls();
    }
  });

  archivePage.addEventListener("click", async () => {
    if (
      !isLiveSelection() ||
      selectedRevisionNumber === null ||
      archivePendingId === selectedPage.id
    ) {
      return;
    }
    const id = selectedPage.id;
    const revisionNumber = selectedRevisionNumber;
    const selectionGeneration = pageSelectionGeneration;
    const authenticationAtStart = authenticationGeneration;
    archivePendingId = id;
    applySelectionControls();
    try {
      const result = await archivePageRequest(
        apiFetch,
        id,
        revisionNumber,
        csrfTokenFromDocument(documentObject),
      );
      if (authenticationAtStart !== authenticationGeneration) return;
      if (mutationAppliesToSelection(id, selectionGeneration)) {
        showSelectedPage(result.page, result.revisionNumber, {
          preserveParentDraft: true,
          preserveTitleDraft: true,
        });
        status.textContent = "Page archived.";
      }
      await refreshActivePages();
      if (authenticationAtStart !== authenticationGeneration) return;
      await refreshArchivedIfVisible();
    } catch (error) {
      if (authenticationAtStart !== authenticationGeneration) {
        return;
      } else if (isAuthenticationError(error)) {
        showLogin("Your session has ended. Please sign in again.");
      } else if (mutationAppliesToSelection(id, selectionGeneration)) {
        handleWorkspaceFailure(error, "Could not archive page.");
      }
    } finally {
      if (archivePendingId === id) archivePendingId = null;
      applySelectionControls();
    }
  });

  restorePage.addEventListener("click", async () => {
    if (
      !isArchivedSelection() ||
      selectedRevisionNumber === null ||
      restorePendingId === selectedPage.id
    ) {
      return;
    }
    const id = selectedPage.id;
    const revisionNumber = selectedRevisionNumber;
    const selectionGeneration = pageSelectionGeneration;
    const authenticationAtStart = authenticationGeneration;
    const parentId = pageParent.value || null;
    restorePendingId = id;
    applySelectionControls();
    try {
      const result = await restorePageRequest(
        apiFetch,
        id,
        parentId,
        revisionNumber,
        csrfTokenFromDocument(documentObject),
      );
      if (authenticationAtStart !== authenticationGeneration) return;
      if (mutationAppliesToSelection(id, selectionGeneration)) {
        showSelectedPage(result.page, result.revisionNumber, {
          preserveParentDraft: true,
          preserveTitleDraft: true,
        });
        status.textContent = "Page restored.";
      }
      await refreshActivePages();
      if (authenticationAtStart !== authenticationGeneration) return;
      await refreshArchivedIfVisible();
    } catch (error) {
      if (authenticationAtStart !== authenticationGeneration) {
        return;
      } else if (isAuthenticationError(error)) {
        showLogin("Your session has ended. Please sign in again.");
      } else if (mutationAppliesToSelection(id, selectionGeneration)) {
        handleWorkspaceFailure(error, "Could not restore page.");
      }
    } finally {
      if (restorePendingId === id) restorePendingId = null;
      applySelectionControls();
    }
  });

  showArchivedPages.addEventListener("click", async () => {
    await loadArchivedPages();
  });

  saveBody.addEventListener("click", async () => {
    if (
      !selectedPage ||
      selectedBodyRevisionNumber === null ||
      pageBody.disabled ||
      saveBody.disabled
    ) {
      return;
    }
    const id = selectedPage.id;
    const selectionGeneration = pageSelectionGeneration;
    const revisionNumber = selectedBodyRevisionNumber;
    const blockId = selectedBodyBlockId;
    const bodyText = pageBody.value;
    bodySavePending = true;
    applyBodyEditability();
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
        selectedPage?.id !== id
      ) {
        return;
      }
      if (showEditableBody(blockDocument)) {
        bodyStatus.textContent = "Page body saved.";
      }
    } catch (error) {
      if (
        selectionGeneration !== pageSelectionGeneration ||
        selectedPage?.id !== id
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
        selectedPage?.id === id
      ) {
        bodySavePending = false;
        applyBodyEditability();
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
