import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

import type { BrowserDocument, BrowserElement } from "../../web/app.js";
import {
  archivePageRequest,
  addRecordRelationRequest,
  createDataSourceRequest,
  createPageRequest,
  createRecordRequest,
  getDataSourcesRequest,
  getAssetsRequest,
  getPageAssetsRequest,
  getBlockDocumentRequest,
  getPageListRequest,
  getSessionRequest,
  loginRequest,
  logoutRequest,
  downloadAssetRequest,
  movePageRequest,
  pageTreeFromPages,
  restorePageRequest,
  searchPagesRequest,
  removeRecordRelationRequest,
  setRecordPropertyRequest,
  startBrowserApp,
  updateBlockDocumentRequest,
  updatePageRequest,
  uploadAssetRequest,
  attachPageAssetRequest,
  unlinkPageAssetRequest,
} from "../../web/app.js";

test("requests linked assets for a page and validates the response", async () => {
  const apiFetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              link: {
                id: "link-1",
                pageId: "page-1",
                assetId: "asset-1",
                createdAt: "2026-09-28T12:00:00.000Z",
                provenance: { source: "nativepos.browser", actorId: "owner" },
              },
              asset: {
                id: "asset-1",
                originalFilename: "proof.txt",
                mimeType: "text/plain",
                byteSize: 5,
                createdAt: "2026-09-28T12:00:00.000Z",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  await expect(getPageAssetsRequest(apiFetch, "page-1")).resolves.toHaveLength(
    1,
  );
  expect(apiFetch).toHaveBeenCalledWith("/api/v1/pages/page-1/assets", {
    credentials: "same-origin",
    method: "GET",
  });
});

test("attaches an uploaded asset to a page using CSRF", async () => {
  const apiFetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          link: {
            id: "link-1",
            pageId: "page-1",
            assetId: "asset-1",
            createdAt: "2026-09-28T12:00:00.000Z",
            provenance: { source: "nativepos.browser", actorId: "owner" },
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
  );
  await attachPageAssetRequest(apiFetch, "page-1", "asset-1", "csrf-token");
  expect(apiFetch).toHaveBeenCalledWith("/api/v1/pages/page-1/assets/asset-1", {
    credentials: "same-origin",
    headers: { "x-pos-csrf": "csrf-token" },
    method: "POST",
  });
});

test("soft-unlinks an asset from a page using CSRF", async () => {
  const apiFetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          link: {
            id: "link-1",
            pageId: "page-1",
            assetId: "asset-1",
            createdAt: "2026-09-28T12:00:00.000Z",
            archivedAt: "2026-09-28T13:00:00.000Z",
            provenance: { source: "nativepos.browser", actorId: "owner" },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  await unlinkPageAssetRequest(apiFetch, "page-1", "asset-1", "csrf-token");
  expect(apiFetch).toHaveBeenCalledWith("/api/v1/pages/page-1/assets/asset-1", {
    credentials: "same-origin",
    headers: { "x-pos-csrf": "csrf-token" },
    method: "DELETE",
  });
});
import { buildApp } from "../src/app.ts";

class FakeElement implements BrowserElement {
  children: FakeElement[] = [];
  disabled = false;
  hidden = false;
  readonly tagName: string;
  textContent = "";
  type = "";
  value = "";
  files: File[] = [];
  download = "";
  href = "";
  clickCount = 0;
  #listeners = new Map<
    string,
    (event: { preventDefault(): void }) => void | Promise<void>
  >();

  constructor(tagName = "div") {
    this.tagName = tagName;
  }

  addEventListener(
    type: string,
    listener: (event: { preventDefault(): void }) => void | Promise<void>,
  ): void {
    this.#listeners.set(type, listener);
  }

  append(child: FakeElement): void {
    this.children.push(child);
  }

  click(): void {
    this.clickCount += 1;
  }

  async emit(type: string): Promise<void> {
    const listener = this.#listeners.get(type);
    if (!listener) throw new Error(`No ${type} listener registered`);
    await listener({ preventDefault() {} });
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children = children;
  }
}

function element(
  elements: Record<string, FakeElement>,
  selector: string,
): FakeElement {
  const result = elements[selector];
  if (!result) throw new Error(`Missing ${selector}`);
  return result;
}

function createBrowserDocument(includeAssets = false): {
  documentObject: BrowserDocument;
  elements: Record<string, FakeElement>;
  createdElements: FakeElement[];
} {
  const selectors = [
    "#login-panel",
    "#login-form",
    "#login-email",
    "#login-password",
    "#login-submit",
    "#login-status",
    "#workspace",
    "#logout",
    "#create-page",
    "#new-page-title",
    "#search-form",
    "#search-query",
    "#search-submit",
    "#search-status",
    "#search-results",
    "#create-child-page",
    "#new-child-page-title",
    "#page-title",
    "#save-page",
    "#breadcrumbs",
    "#page-parent",
    "#save-parent",
    "#archive-page",
    "#restore-page",
    "#page-body",
    "#save-body",
    "#body-status",
    "#page-list",
    "#show-archived-pages",
    "#archived-pages",
    "#archived-page-list",
    "#editor",
    "#empty-state",
    "#status",
  ];
  if (includeAssets) {
    selectors.push(
      "#asset-file",
      "#upload-asset",
      "#asset-list",
      "#asset-status",
    );
  }
  const elements: Record<string, FakeElement> = Object.fromEntries(
    selectors.map((selector) => [selector, new FakeElement()]),
  );
  const createdElements: FakeElement[] = [];
  return {
    documentObject: {
      cookie: "pos_csrf=csrf-token",
      createElement: (tagName: string) => {
        const created = new FakeElement(tagName);
        createdElements.push(created);
        return created;
      },
      querySelector: (selector: string) => elements[selector] ?? null,
    },
    elements,
    createdElements,
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise!: (value: T) => void;
  return {
    promise: new Promise<T>((resolve) => {
      resolvePromise = resolve;
    }),
    resolve(value: T): void {
      resolvePromise(value);
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function livePage(id: string, title: string, parentId: string | null = null) {
  return { archivedAt: null, id, parentId, title };
}

function archivedPage(
  id: string,
  title: string,
  parentId: string | null = null,
) {
  return {
    archivedAt: "2026-09-22T12:00:00.000Z",
    id,
    parentId,
    title,
  };
}

test("search helper requests bounded results and rejects malformed payloads", async () => {
  const result = {
    pageId: "11111111-1111-4111-8111-111111111111",
    pageTitle: "<unsafe>",
    snippet: "plain <script> text",
    matchSource: "paragraph",
    rank: 250,
  };
  const apiFetch = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({ results: [result] }))
    .mockResolvedValueOnce(
      jsonResponse({ results: [{ ...result, snippet: "x".repeat(241) }] }),
    );
  await expect(searchPagesRequest(apiFetch, " alpha ")).resolves.toEqual([
    result,
  ]);
  expect(apiFetch).toHaveBeenNthCalledWith(
    1,
    "/api/v1/search?q=alpha&limit=20",
    {
      credentials: "same-origin",
      method: "GET",
    },
  );
  await expect(searchPagesRequest(apiFetch, "alpha")).rejects.toThrow(
    "NativePOS is unavailable",
  );
  await expect(searchPagesRequest(apiFetch, "a")).rejects.toThrow(
    "Search query is invalid",
  );
});

test("browser renders search text safely and selecting a result opens its page", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const id = "11111111-1111-4111-8111-111111111111";
  const apiFetch = vi.fn((url: string) => {
    if (url === "/api/v1/auth/session")
      return Promise.resolve(jsonResponse({ authenticated: true }));
    if (url === "/api/v1/pages")
      return Promise.resolve(jsonResponse({ pages: [] }));
    if (url === "/api/v1/search?q=alpha&limit=20")
      return Promise.resolve(
        jsonResponse({
          results: [
            {
              pageId: id,
              pageTitle: "<Alpha>",
              snippet: "body <script>",
              matchSource: "paragraph",
              rank: 250,
            },
          ],
        }),
      );
    if (url === `/api/v1/pages/${id}`)
      return Promise.resolve(
        jsonResponse({ page: livePage(id, "<Alpha>"), revisionNumber: 1 }),
      );
    if (url === `/api/v1/pages/${id}/blocks`)
      return Promise.resolve(
        jsonResponse({ pageId: id, revisionNumber: 0, blocks: [] }),
      );
    throw new Error(`Unexpected browser request: ${url}`);
  });
  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  element(elements, "#search-query").value = "alpha";
  await element(elements, "#search-form").emit("submit");
  const button = element(elements, "#search-results").children[0]?.children[0];
  expect(button?.children[0]?.textContent).toBe("<Alpha>");
  expect(button?.children[1]?.textContent).toBe("paragraph: body <script>");
  await button?.emit("click");
  expect(element(elements, "#page-title").value).toBe("<Alpha>");
});

test("browser keeps only the newest search response and shows empty and error states", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const first = createDeferred<Response>();
  const apiFetch = vi.fn((url: string) => {
    if (url === "/api/v1/auth/session")
      return Promise.resolve(jsonResponse({ authenticated: true }));
    if (url === "/api/v1/pages")
      return Promise.resolve(jsonResponse({ pages: [] }));
    if (url.includes("q=first")) return first.promise;
    if (url.includes("q=second"))
      return Promise.resolve(jsonResponse({ results: [] }));
    if (url.includes("q=broken"))
      return Promise.resolve(jsonResponse({ error: "no" }, 500));
    throw new Error(`Unexpected browser request: ${url}`);
  });
  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  element(elements, "#search-query").value = "first";
  const stale = element(elements, "#search-form").emit("submit");
  element(elements, "#search-query").value = "second";
  await element(elements, "#search-form").emit("submit");
  first.resolve(
    jsonResponse({
      results: [
        {
          pageId: randomUUID(),
          pageTitle: "Stale",
          snippet: "first",
          matchSource: "title",
          rank: 500,
        },
      ],
    }),
  );
  await stale;
  expect(element(elements, "#search-status").textContent).toBe("No results.");
  expect(element(elements, "#search-results").children).toEqual([]);
  element(elements, "#search-query").value = "broken";
  await element(elements, "#search-form").emit("submit");
  expect(element(elements, "#search-status").textContent).toBe(
    "Could not search pages.",
  );
});

const browserAsset = {
  id: "11111111-1111-4111-8111-111111111111",
  originalFilename: "<unsafe>.txt",
  mimeType: "text/plain",
  byteSize: 5,
  createdAt: "2026-09-25T12:00:00.000Z",
};

test("browser asset helpers use bounded authenticated raw-byte requests", async () => {
  const file = new File(["proof"], "proof notes.txt", { type: "text/plain" });
  const apiFetch = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({ assets: [browserAsset] }))
    .mockResolvedValueOnce(jsonResponse({ asset: browserAsset }, 201))
    .mockResolvedValueOnce(
      new Response("proof", {
        headers: { "content-type": "application/octet-stream" },
      }),
    );

  await expect(getAssetsRequest(apiFetch)).resolves.toEqual([browserAsset]);
  await expect(
    uploadAssetRequest(apiFetch, file, "csrf-token"),
  ).resolves.toEqual(browserAsset);
  const blob = await downloadAssetRequest(apiFetch, browserAsset.id);
  expect(await blob.text()).toBe("proof");
  expect(apiFetch).toHaveBeenNthCalledWith(1, "/api/v1/assets?limit=50", {
    credentials: "same-origin",
    method: "GET",
  });
  expect(apiFetch).toHaveBeenNthCalledWith(
    2,
    "/api/v1/assets",
    expect.objectContaining({
      body: expect.any(ArrayBuffer),
      credentials: "same-origin",
      headers: {
        "content-type": "application/octet-stream",
        "x-nativepos-filename": encodeURIComponent(file.name),
        "x-nativepos-media-type": "text/plain",
        "x-pos-csrf": "csrf-token",
      },
      method: "POST",
    }),
  );
  expect(apiFetch).toHaveBeenNthCalledWith(
    3,
    `/api/v1/assets/${browserAsset.id}/content`,
    { credentials: "same-origin", method: "GET" },
  );
});

test("browser loads assets only after session confirmation and renders metadata as text", async () => {
  const { documentObject, elements } = createBrowserDocument(true);
  const calls: string[] = [];
  const apiFetch = vi.fn((url: string) => {
    calls.push(url);
    if (url === "/api/v1/auth/session")
      return Promise.resolve(jsonResponse({ authenticated: true }));
    if (url === "/api/v1/pages")
      return Promise.resolve(jsonResponse({ pages: [] }));
    if (url === "/api/v1/assets?limit=50")
      return Promise.resolve(jsonResponse({ assets: [browserAsset] }));
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);

  expect(calls.indexOf("/api/v1/auth/session")).toBeLessThan(
    calls.indexOf("/api/v1/assets?limit=50"),
  );
  const assetItem = element(elements, "#asset-list").children[0];
  expect(assetItem?.children[0]?.textContent).toContain("<unsafe>.txt");
  expect(element(elements, "#workspace").hidden).toBe(false);
});

test("browser disables asset upload while pending and refreshes the bounded list", async () => {
  const { documentObject, elements } = createBrowserDocument(true);
  const uploadResponse = createDeferred<Response>();
  let assetReads = 0;
  const apiFetch = vi.fn((url: string, options?: { method?: string }) => {
    if (url === "/api/v1/auth/session")
      return Promise.resolve(jsonResponse({ authenticated: true }));
    if (url === "/api/v1/pages")
      return Promise.resolve(jsonResponse({ pages: [] }));
    if (url === "/api/v1/assets?limit=50") {
      assetReads += 1;
      return Promise.resolve(
        jsonResponse({ assets: assetReads === 1 ? [] : [browserAsset] }),
      );
    }
    if (url === "/api/v1/assets" && options?.method === "POST")
      return uploadResponse.promise;
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  element(elements, "#asset-file").files = [
    new File(["proof"], "proof.txt", { type: "text/plain" }),
  ];
  const uploading = element(elements, "#upload-asset").emit("click");
  await Promise.resolve();
  expect(element(elements, "#asset-file").disabled).toBe(true);
  expect(element(elements, "#upload-asset").disabled).toBe(true);

  uploadResponse.resolve(jsonResponse({ asset: browserAsset }, 201));
  await uploading;

  expect(element(elements, "#asset-file").disabled).toBe(false);
  expect(element(elements, "#upload-asset").disabled).toBe(false);
  expect(element(elements, "#asset-list").children).toHaveLength(1);
});

test("browser downloads through an authenticated object URL and always revokes it", async () => {
  const { documentObject, elements, createdElements } =
    createBrowserDocument(true);
  const createObjectURL = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:nativepos-test");
  const revokeObjectURL = vi
    .spyOn(URL, "revokeObjectURL")
    .mockImplementation(() => undefined);
  const apiFetch = vi.fn((url: string) => {
    if (url === "/api/v1/auth/session")
      return Promise.resolve(jsonResponse({ authenticated: true }));
    if (url === "/api/v1/pages")
      return Promise.resolve(jsonResponse({ pages: [] }));
    if (url === "/api/v1/assets?limit=50")
      return Promise.resolve(jsonResponse({ assets: [browserAsset] }));
    if (url === `/api/v1/assets/${browserAsset.id}/content`)
      return Promise.resolve(new Response("proof"));
    throw new Error(`Unexpected browser request: ${url}`);
  });

  try {
    await startBrowserApp(documentObject, apiFetch as typeof fetch);
    const downloadButton = element(elements, "#asset-list").children[0]
      ?.children[1];
    await downloadButton?.emit("click");
    const anchor = createdElements.find(
      (candidate) => candidate.tagName === "a",
    );
    expect(anchor).toMatchObject({
      clickCount: 1,
      download: browserAsset.originalFilename,
      href: "blob:nativepos-test",
    });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:nativepos-test");
  } finally {
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  }
});

test("browser discards a late asset upload after logout", async () => {
  const { documentObject, elements } = createBrowserDocument(true);
  const uploadResponse = createDeferred<Response>();
  const apiFetch = vi.fn((url: string, options?: { method?: string }) => {
    if (url === "/api/v1/auth/session")
      return Promise.resolve(jsonResponse({ authenticated: true }));
    if (url === "/api/v1/pages")
      return Promise.resolve(jsonResponse({ pages: [] }));
    if (url === "/api/v1/assets?limit=50")
      return Promise.resolve(jsonResponse({ assets: [] }));
    if (url === "/api/v1/assets" && options?.method === "POST")
      return uploadResponse.promise;
    if (url === "/api/v1/auth/logout")
      return Promise.resolve(new Response(null, { status: 204 }));
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  element(elements, "#asset-file").files = [
    new File(["proof"], "proof.txt", { type: "text/plain" }),
  ];
  const uploading = element(elements, "#upload-asset").emit("click");
  await Promise.resolve();
  await element(elements, "#logout").emit("click");
  uploadResponse.resolve(jsonResponse({ asset: browserAsset }, 201));
  await uploading;

  expect(element(elements, "#workspace").hidden).toBe(true);
  expect(element(elements, "#asset-list").children).toEqual([]);
});

function navigationButtons(container: FakeElement): FakeElement[] {
  const result: FakeElement[] = [];
  function visit(node: FakeElement): void {
    if (node.tagName === "button") result.push(node);
    for (const child of node.children) visit(child);
  }
  visit(container);
  return result;
}

function pageListButton(
  elements: Record<string, FakeElement>,
  index = 0,
): FakeElement {
  const button = navigationButtons(element(elements, "#page-list"))[index];
  if (!button) throw new Error("Missing page list button");
  return button;
}

function archivedPageListButton(
  elements: Record<string, FakeElement>,
  index = 0,
): FakeElement {
  const button = navigationButtons(element(elements, "#archived-page-list"))[
    index
  ];
  if (!button) throw new Error("Missing archived page list button");
  return button;
}

test("serves an accessible NativePOS browser shell", async () => {
  const app = buildApp();
  const response = await app.inject({ method: "GET", url: "/" });

  expect(response.statusCode).toBe(200);
  expect(response.headers["content-type"]).toContain("text/html");
  expect(response.body).toContain('<h1 id="login-title">NativePOS</h1>');
  expect(response.body).toContain('aria-label="Sign in to NativePOS"');
  expect(response.body).toContain('autocomplete="username"');
  expect(response.body).toContain('autocomplete="current-password"');
  expect(response.body).toContain(
    '<div id="workspace" class="app-shell" hidden>',
  );
  expect(response.body).toContain('id="logout"');
  expect(response.body).toContain('<label for="page-body">Page body</label>');
  expect(response.body).toContain('id="page-body"');
  expect(response.body).toContain('id="save-body"');
  expect(response.body).toContain('id="create-child-page"');
  expect(response.body).toContain('id="breadcrumbs"');
  expect(response.body).toContain('id="page-parent"');
  expect(response.body).toContain('id="archive-page"');
  expect(response.body).toContain('id="restore-page"');
  expect(response.body).toContain('id="show-archived-pages"');
  await app.close();
});

test("serves shell files from an explicit packaged asset root", async () => {
  const root = mkdtempSync(join(tmpdir(), "nativepos-web-assets-"));
  writeFileSync(join(root, "index.html"), "<h1>Packaged NativePOS</h1>");
  writeFileSync(join(root, "app.js"), "console.log('packaged');");
  writeFileSync(join(root, "styles.css"), "body { color: black; }");
  const app = buildApp({ webAssetRoot: root });

  try {
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Packaged NativePOS");
  } finally {
    await app.close();
    rmSync(root, { force: true, recursive: true });
  }
});

test("rejects a configured web asset root without the required files", () => {
  const missing = join(tmpdir(), "nativepos-missing-" + randomUUID());
  expect(() => buildApp({ webAssetRoot: missing })).toThrow(
    "NativePOS web assets are unavailable",
  );
});

test("rejects an asset symlink that escapes the configured web root", () => {
  const root = mkdtempSync(join(tmpdir(), "nativepos-web-root-"));
  const outside = mkdtempSync(join(tmpdir(), "nativepos-web-outside-"));
  writeFileSync(join(root, "app.js"), "console.log('root');");
  writeFileSync(join(root, "styles.css"), "body { color: black; }");
  const outsideIndex = join(outside, "index.html");
  writeFileSync(outsideIndex, "<h1>Outside NativePOS</h1>");
  symlinkSync(outsideIndex, join(root, "index.html"), "file");

  try {
    expect(() => buildApp({ webAssetRoot: root })).toThrow(
      "NativePOS web assets are unavailable",
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
    rmSync(outside, { force: true, recursive: true });
  }
});

test("browser client sends create and update requests to versioned routes", async () => {
  const apiFetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          page: livePage("page-1", "Domain"),
          revisionNumber: 1,
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          page: livePage("page-1", "Projects"),
          revisionNumber: 2,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

  await expect(
    createPageRequest(apiFetch, "Domain", "csrf-token"),
  ).resolves.toMatchObject({ page: { title: "Domain" } });
  await expect(
    updatePageRequest(apiFetch, "page-1", "Projects", 1, "csrf-token"),
  ).resolves.toMatchObject({ page: { title: "Projects" } });
  expect(apiFetch).toHaveBeenNthCalledWith(1, "/api/v1/pages", {
    credentials: "same-origin",
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pos-csrf": "csrf-token",
    },
    body: JSON.stringify({ title: "Domain" }),
  });
  expect(apiFetch).toHaveBeenNthCalledWith(2, "/api/v1/pages/page-1", {
    credentials: "same-origin",
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "if-match": "1",
      "x-pos-csrf": "csrf-token",
    },
    body: JSON.stringify({ title: "Projects" }),
  });
});

test("browser hierarchy request helpers send scoped reads and revisioned mutations", async () => {
  const apiFetch = vi
    .fn()
    .mockResolvedValueOnce(
      jsonResponse(
        { page: livePage("child", "Child", "root"), revisionNumber: 1 },
        201,
      ),
    )
    .mockResolvedValueOnce(jsonResponse({ pages: [livePage("root", "Root")] }))
    .mockResolvedValueOnce(
      jsonResponse({ pages: [archivedPage("child", "Child", "root")] }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        page: livePage("child", "Child", "other-root"),
        revisionNumber: 2,
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        page: archivedPage("child", "Child", "other-root"),
        revisionNumber: 3,
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        page: livePage("child", "Child", null),
        revisionNumber: 4,
      }),
    );

  await expect(
    createPageRequest(apiFetch, "Child", "csrf-token", "root"),
  ).resolves.toMatchObject({ page: { parentId: "root", title: "Child" } });
  await expect(getPageListRequest(apiFetch)).resolves.toEqual([
    livePage("root", "Root"),
  ]);
  await expect(getPageListRequest(apiFetch, "archived")).resolves.toEqual([
    archivedPage("child", "Child", "root"),
  ]);
  await expect(
    movePageRequest(apiFetch, "child", "other-root", 1, "csrf-token"),
  ).resolves.toMatchObject({ revisionNumber: 2 });
  await expect(
    archivePageRequest(apiFetch, "child", 2, "csrf-token"),
  ).resolves.toMatchObject({ revisionNumber: 3 });
  await expect(
    restorePageRequest(apiFetch, "child", null, 3, "csrf-token"),
  ).resolves.toMatchObject({ revisionNumber: 4 });

  expect(apiFetch).toHaveBeenNthCalledWith(1, "/api/v1/pages", {
    body: JSON.stringify({ title: "Child", parentId: "root" }),
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-pos-csrf": "csrf-token",
    },
    method: "POST",
  });
  expect(apiFetch).toHaveBeenNthCalledWith(2, "/api/v1/pages", {
    credentials: "same-origin",
    method: "GET",
  });
  expect(apiFetch).toHaveBeenNthCalledWith(3, "/api/v1/pages?archived=only", {
    credentials: "same-origin",
    method: "GET",
  });
  expect(apiFetch).toHaveBeenNthCalledWith(4, "/api/v1/pages/child/parent", {
    body: JSON.stringify({ parentId: "other-root" }),
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "if-match": "1",
      "x-pos-csrf": "csrf-token",
    },
    method: "PUT",
  });
  expect(apiFetch).toHaveBeenNthCalledWith(5, "/api/v1/pages/child/archive", {
    body: JSON.stringify({}),
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "if-match": "2",
      "x-pos-csrf": "csrf-token",
    },
    method: "POST",
  });
  expect(apiFetch).toHaveBeenNthCalledWith(6, "/api/v1/pages/child/restore", {
    body: JSON.stringify({ parentId: null }),
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "if-match": "3",
      "x-pos-csrf": "csrf-token",
    },
    method: "PUT",
  });
});

test("browser structured-data helpers use bounded reads, CSRF, and quoted record revisions", async () => {
  const record = {
    item: { id: "record-1", sourceId: "source-1" },
    page: { id: "record-1", title: "Ship skeleton" },
    propertyRevisionNumber: 1,
    values: {},
  };
  const apiFetch = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({ sources: [] }))
    .mockResolvedValueOnce(
      jsonResponse({ source: { id: "source-1", name: "Projects" } }, 201),
    )
    .mockResolvedValueOnce(jsonResponse({ record }, 201))
    .mockResolvedValueOnce(
      jsonResponse({ record: { ...record, propertyRevisionNumber: 2 } }),
    )
    .mockResolvedValueOnce(
      jsonResponse({ record: { ...record, propertyRevisionNumber: 3 } }, 201),
    )
    .mockResolvedValueOnce(
      jsonResponse({ record: { ...record, propertyRevisionNumber: 4 } }),
    );

  await getDataSourcesRequest(apiFetch);
  await createDataSourceRequest(apiFetch, "Projects", "csrf-token");
  await createRecordRequest(
    apiFetch,
    "source-1",
    "Ship skeleton",
    "csrf-token",
  );
  await setRecordPropertyRequest(
    apiFetch,
    "record-1",
    "definition-1",
    "Open",
    1,
    "csrf-token",
  );
  await addRecordRelationRequest(
    apiFetch,
    "record-1",
    "relation-1",
    "record-2",
    2,
    "csrf-token",
  );
  await removeRecordRelationRequest(apiFetch, "edge-1", 3, "csrf-token");

  expect(apiFetch).toHaveBeenNthCalledWith(
    1,
    "/api/v1/data-sources?limit=100&offset=0",
    { credentials: "same-origin", method: "GET" },
  );
  expect(apiFetch).toHaveBeenNthCalledWith(
    4,
    "/api/v1/records/record-1/properties/definition-1",
    expect.objectContaining({
      headers: expect.objectContaining({
        "if-match": '"1"',
        "x-pos-csrf": "csrf-token",
      }),
      method: "PUT",
    }),
  );
  expect(apiFetch).toHaveBeenNthCalledWith(
    6,
    "/api/v1/relations/edge-1",
    expect.objectContaining({
      headers: expect.objectContaining({ "if-match": '"3"' }),
      method: "DELETE",
    }),
  );
});

test("browser page trees are bounded, validated, and breadcrumbed before rendering", () => {
  const hierarchy = pageTreeFromPages(
    [
      livePage("root", "Root"),
      livePage("child", "Child", "root"),
      livePage("leaf", "Leaf", "child"),
    ],
    "active",
  );

  expect(hierarchy.roots).toMatchObject([
    {
      children: [
        {
          children: [{ children: [], page: { id: "leaf", title: "Leaf" } }],
          page: { id: "child", title: "Child" },
        },
      ],
      page: { id: "root", title: "Root" },
    },
  ]);
  expect(hierarchy.breadcrumbs.get("leaf")?.map((page) => page.title)).toEqual([
    "Root",
    "Child",
    "Leaf",
  ]);
  const archivedHierarchy = pageTreeFromPages(
    [archivedPage("archived-leaf", "Archived leaf", "root")],
    "archived",
    [livePage("root", "Root")],
  );
  expect(archivedHierarchy.roots.map((node) => node.page.id)).toEqual([
    "archived-leaf",
  ]);
  expect(
    archivedHierarchy.breadcrumbs
      .get("archived-leaf")
      ?.map((page) => page.title),
  ).toEqual(["Root", "Archived leaf"]);

  const atDepthLimit = Array.from({ length: 33 }, (_, index) =>
    livePage(
      "at-limit-" + String(index),
      "At limit " + String(index),
      index === 0 ? null : "at-limit-" + String(index - 1),
    ),
  );
  const beyondDepthLimit = [
    ...atDepthLimit,
    livePage("too-deep", "Too deep", "at-limit-32"),
  ];

  expect(() => pageTreeFromPages(atDepthLimit, "active")).not.toThrow();
  for (const invalid of [
    [livePage("child", "Child", "missing")],
    [
      livePage("first", "First", "second"),
      livePage("second", "Second", "first"),
    ],
    beyondDepthLimit,
    [archivedPage("archived", "Archived")],
  ]) {
    expect(() => pageTreeFromPages(invalid, "active")).toThrow(
      "NativePOS is unavailable",
    );
  }
});

test("browser block-document requests use quoted body revisions and CSRF proof", async () => {
  const apiFetch = vi
    .fn()
    .mockResolvedValueOnce(
      jsonResponse({
        document: { pageId: "page-1", revisionNumber: 0, blocks: [] },
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        document: {
          pageId: "page-1",
          revisionNumber: 1,
          blocks: [
            {
              id: "block-1",
              parentBlockId: null,
              blockType: "paragraph",
              position: 0,
              content: { text: "First body" },
            },
          ],
        },
      }),
    );

  await expect(getBlockDocumentRequest(apiFetch, "page-1")).resolves.toEqual({
    pageId: "page-1",
    revisionNumber: 0,
    blocks: [],
  });
  await expect(
    updateBlockDocumentRequest(
      apiFetch,
      "page-1",
      [
        {
          clientRef: "browser-body-1",
          blockType: "paragraph",
          content: { text: "First body" },
        },
      ],
      0,
      "csrf-token",
    ),
  ).resolves.toMatchObject({ revisionNumber: 1 });
  expect(apiFetch).toHaveBeenNthCalledWith(1, "/api/v1/pages/page-1/blocks", {
    credentials: "same-origin",
    method: "GET",
  });
  expect(apiFetch).toHaveBeenNthCalledWith(2, "/api/v1/pages/page-1/blocks", {
    credentials: "same-origin",
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "if-match": '"0"',
      "x-pos-csrf": "csrf-token",
    },
    body: JSON.stringify({
      blocks: [
        {
          clientRef: "browser-body-1",
          blockType: "paragraph",
          content: { text: "First body" },
        },
      ],
    }),
  });
});

test("browser authentication requests use same-origin cookies and CSRF logout", async () => {
  const apiFetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ authenticated: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ authenticated: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }));

  await expect(getSessionRequest(apiFetch)).resolves.toBe(true);
  await expect(
    loginRequest(apiFetch, "owner@example.test", "test-password"),
  ).resolves.toBeUndefined();
  await expect(logoutRequest(apiFetch, "csrf-token")).resolves.toBeUndefined();

  expect(apiFetch).toHaveBeenNthCalledWith(1, "/api/v1/auth/session", {
    credentials: "same-origin",
    method: "GET",
  });
  expect(apiFetch).toHaveBeenNthCalledWith(2, "/api/v1/auth/login", {
    body: JSON.stringify({
      email: "owner@example.test",
      password: "test-password",
    }),
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(apiFetch).toHaveBeenNthCalledWith(3, "/api/v1/auth/logout", {
    credentials: "same-origin",
    headers: {
      "x-pos-csrf": "csrf-token",
    },
    method: "POST",
  });
});

test("browser session probe rejects malformed or unavailable responses", async () => {
  const apiFetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 500 }));

  await expect(getSessionRequest(apiFetch)).resolves.toBe(false);
  await expect(getSessionRequest(apiFetch)).resolves.toBe(false);
  await expect(getSessionRequest(apiFetch)).rejects.toThrow(
    "NativePOS is unavailable",
  );
});

test("browser logout refuses to claim success without a CSRF cookie", async () => {
  const apiFetch = vi.fn();

  await expect(logoutRequest(apiFetch, "")).rejects.toThrow(
    "CSRF token is unavailable",
  );
  expect(apiFetch).not.toHaveBeenCalled();
});

test("browser login rejects malformed or untrusted success responses", async () => {
  for (const body of [
    { authenticated: false },
    {},
    { authenticated: "true" },
  ]) {
    const apiFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      loginRequest(apiFetch, "owner@example.test", "test-password"),
    ).rejects.toThrow("NativePOS is unavailable");
  }

  const malformedResponse = vi
    .fn()
    .mockResolvedValue(new Response("{", { status: 200 }));
  await expect(
    loginRequest(malformedResponse, "owner@example.test", "test-password"),
  ).rejects.toThrow("NativePOS is unavailable");
});

test("browser controller keeps workspace hidden before authentication", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const apiFetch = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 401 }));

  await startBrowserApp(documentObject, apiFetch);

  expect(element(elements, "#login-panel").hidden).toBe(false);
  expect(element(elements, "#workspace").hidden).toBe(true);
  expect(apiFetch.mock.calls.map(([url]) => url)).toEqual([
    "/api/v1/auth/session",
  ]);
});

test("browser controller reveals workspace only after successful login", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const apiFetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ authenticated: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ authenticated: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ pages: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  element(elements, "#login-email").value = "owner@example.test";
  element(elements, "#login-password").value = "test-password";

  await startBrowserApp(documentObject, apiFetch);
  await element(elements, "#login-form").emit("submit");

  expect(element(elements, "#login-panel").hidden).toBe(true);
  expect(element(elements, "#workspace").hidden).toBe(false);
  expect(element(elements, "#login-password").value).toBe("");
  expect(apiFetch).toHaveBeenNthCalledWith(3, "/api/v1/auth/session", {
    credentials: "same-origin",
    method: "GET",
  });
  expect(apiFetch).toHaveBeenLastCalledWith("/api/v1/pages", {
    credentials: "same-origin",
    method: "GET",
  });
});

test("browser controller renders safe authentication failures", async () => {
  const unavailable = createBrowserDocument();
  const unavailableFetch = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 500 }));

  await startBrowserApp(unavailable.documentObject, unavailableFetch);

  expect(element(unavailable.elements, "#workspace").hidden).toBe(true);
  expect(element(unavailable.elements, "#login-status").textContent).toBe(
    "NativePOS is unavailable.",
  );

  const invalidLogin = createBrowserDocument();
  const invalidLoginFetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid credentials" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
  element(invalidLogin.elements, "#login-email").value = "owner@example.test";
  element(invalidLogin.elements, "#login-password").value = "test-password";

  await startBrowserApp(invalidLogin.documentObject, invalidLoginFetch);
  await element(invalidLogin.elements, "#login-form").emit("submit");

  expect(element(invalidLogin.elements, "#workspace").hidden).toBe(true);
  expect(element(invalidLogin.elements, "#login-status").textContent).toBe(
    "Incorrect email or password.",
  );
});

test("browser controller renders generic availability feedback for a rejected session probe", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const apiFetch = vi.fn().mockRejectedValue(new Error("network details"));

  await startBrowserApp(documentObject, apiFetch);

  expect(element(elements, "#workspace").hidden).toBe(true);
  expect(element(elements, "#login-status").textContent).toBe(
    "NativePOS is unavailable.",
  );
});

test("browser controller never opens the workspace for an untrusted login response", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const apiFetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  element(elements, "#login-email").value = "owner@example.test";
  element(elements, "#login-password").value = "test-password";

  await startBrowserApp(documentObject, apiFetch);
  await element(elements, "#login-form").emit("submit");

  expect(element(elements, "#workspace").hidden).toBe(true);
  expect(element(elements, "#login-status").textContent).toBe(
    "NativePOS is unavailable.",
  );
  expect(apiFetch.mock.calls.map(([url]) => url)).toEqual([
    "/api/v1/auth/session",
    "/api/v1/auth/login",
  ]);
});

test("browser ignores a stale session probe after login and logout", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const initialSession = createDeferred<Response>();
  let sessionRequestCount = 0;
  const apiFetch = vi.fn((url: string) => {
    if (url === "/api/v1/auth/session") {
      sessionRequestCount += 1;
      return sessionRequestCount === 1
        ? initialSession.promise
        : Promise.resolve(
            new Response(JSON.stringify({ authenticated: true }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
    }
    if (url === "/api/v1/auth/login") {
      return Promise.resolve(
        new Response(JSON.stringify({ authenticated: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (url === "/api/v1/pages") {
      return Promise.resolve(
        new Response(JSON.stringify({ pages: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (url === "/api/v1/auth/logout") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    throw new Error(`Unexpected browser request: ${url}`);
  });
  element(elements, "#login-email").value = "owner@example.test";
  element(elements, "#login-password").value = "test-password";

  const starting = startBrowserApp(documentObject, apiFetch as typeof fetch);
  await element(elements, "#login-form").emit("submit");
  await element(elements, "#logout").emit("click");
  initialSession.resolve(
    new Response(JSON.stringify({ authenticated: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  await starting;

  expect(element(elements, "#workspace").hidden).toBe(true);
  expect(
    apiFetch.mock.calls.filter(([url]) => url === "/api/v1/pages"),
  ).toHaveLength(1);
});

test("browser controller keeps the workspace visible if logout lacks CSRF proof", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const apiFetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ authenticated: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ pages: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

  await startBrowserApp(documentObject, apiFetch);
  documentObject.cookie = "";
  await element(elements, "#logout").emit("click");

  expect(element(elements, "#workspace").hidden).toBe(false);
  expect(element(elements, "#status").textContent).toBe("Could not sign out.");
  expect(apiFetch).toHaveBeenCalledTimes(2);
});

test("browser controller returns to login after confirmed logout", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const apiFetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ authenticated: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ pages: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }));

  await startBrowserApp(documentObject, apiFetch);
  await element(elements, "#logout").emit("click");

  expect(element(elements, "#workspace").hidden).toBe(true);
  expect(element(elements, "#login-panel").hidden).toBe(false);
  expect(apiFetch).toHaveBeenLastCalledWith("/api/v1/auth/logout", {
    credentials: "same-origin",
    headers: { "x-pos-csrf": "csrf-token" },
    method: "POST",
  });
});

test("browser selection loads an empty body document after page metadata", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const apiFetch = vi.fn((url: string) => {
    if (url === "/api/v1/auth/session") {
      return Promise.resolve(jsonResponse({ authenticated: true }));
    }
    if (url === "/api/v1/pages") {
      return Promise.resolve(
        jsonResponse({ pages: [livePage("page-1", "Projects")] }),
      );
    }
    if (url === "/api/v1/pages/page-1") {
      return Promise.resolve(
        jsonResponse({
          page: livePage("page-1", "Projects"),
          revisionNumber: 7,
        }),
      );
    }
    if (url === "/api/v1/pages/page-1/blocks") {
      return Promise.resolve(
        jsonResponse({
          document: { pageId: "page-1", revisionNumber: 0, blocks: [] },
        }),
      );
    }
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  await pageListButton(elements).emit("click");

  expect(element(elements, "#page-title").value).toBe("Projects");
  expect(element(elements, "#page-body").value).toBe("");
  expect(element(elements, "#page-body").disabled).toBe(false);
  expect(element(elements, "#save-body").disabled).toBe(false);
  const metadataCall = apiFetch.mock.calls.findIndex(
    ([url]) => url === "/api/v1/pages/page-1",
  );
  const bodyCall = apiFetch.mock.calls.findIndex(
    ([url]) => url === "/api/v1/pages/page-1/blocks",
  );
  expect(metadataCall).toBeGreaterThan(-1);
  expect(bodyCall).toBeGreaterThan(metadataCall);
});

test("browser fails closed with generic feedback when a body document cannot load", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const apiFetch = vi.fn((url: string) => {
    if (url === "/api/v1/auth/session") {
      return Promise.resolve(jsonResponse({ authenticated: true }));
    }
    if (url === "/api/v1/pages") {
      return Promise.resolve(
        jsonResponse({ pages: [livePage("page-1", "Projects")] }),
      );
    }
    if (url === "/api/v1/pages/page-1") {
      return Promise.resolve(
        jsonResponse({
          page: livePage("page-1", "Projects"),
          revisionNumber: 7,
        }),
      );
    }
    if (url === "/api/v1/pages/page-1/blocks") {
      return Promise.resolve(jsonResponse({ error: "storage details" }, 500));
    }
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  await pageListButton(elements).emit("click");

  expect(element(elements, "#page-body").disabled).toBe(true);
  expect(element(elements, "#save-body").disabled).toBe(true);
  expect(element(elements, "#body-status").textContent).toBe(
    "Could not load page body.",
  );
});

test("browser body save retains a root block ID and keeps title and body revisions separate", async () => {
  const { documentObject, elements } = createBrowserDocument();
  let bodyWriteCount = 0;
  const apiFetch = vi.fn((url: string, options?: { method?: string }) => {
    if (url === "/api/v1/auth/session") {
      return Promise.resolve(jsonResponse({ authenticated: true }));
    }
    if (url === "/api/v1/pages") {
      return Promise.resolve(
        jsonResponse({ pages: [livePage("page-1", "Projects")] }),
      );
    }
    if (url === "/api/v1/pages/page-1" && options?.method === "GET") {
      return Promise.resolve(
        jsonResponse({
          page: livePage("page-1", "Projects"),
          revisionNumber: 7,
        }),
      );
    }
    if (url === "/api/v1/pages/page-1/blocks" && options?.method === "GET") {
      return Promise.resolve(
        jsonResponse({
          document: {
            pageId: "page-1",
            revisionNumber: 3,
            blocks: [
              {
                id: "block-1",
                parentBlockId: null,
                blockType: "paragraph",
                position: 0,
                content: { text: "" },
              },
            ],
          },
        }),
      );
    }
    if (url === "/api/v1/pages/page-1/blocks" && options?.method === "PUT") {
      bodyWriteCount += 1;
      return Promise.resolve(
        jsonResponse({
          document: {
            pageId: "page-1",
            revisionNumber: bodyWriteCount + 3,
            blocks: [
              {
                id: "block-1",
                parentBlockId: null,
                blockType: "paragraph",
                position: 0,
                content: {
                  text: bodyWriteCount === 1 ? "Canonical body" : "Second body",
                },
              },
            ],
          },
        }),
      );
    }
    if (url === "/api/v1/pages/page-1" && options?.method === "PATCH") {
      return Promise.resolve(
        jsonResponse({
          page: livePage("page-1", "Renamed Projects"),
          revisionNumber: 8,
        }),
      );
    }
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  await pageListButton(elements).emit("click");
  expect(element(elements, "#page-body").value).toBe("");

  element(elements, "#page-body").value = "Updated body";
  await element(elements, "#save-body").emit("click");

  const bodyWrite = apiFetch.mock.calls.find(
    ([url, options]) =>
      url === "/api/v1/pages/page-1/blocks" &&
      (options as { method?: string }).method === "PUT",
  );
  expect(bodyWrite?.[1]).toMatchObject({
    credentials: "same-origin",
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "if-match": '"3"',
      "x-pos-csrf": "csrf-token",
    },
  });
  expect(JSON.parse((bodyWrite?.[1] as { body: string }).body)).toEqual({
    blocks: [
      {
        clientRef: expect.stringMatching(/^browser-body-[1-9][0-9]*$/u),
        id: "block-1",
        blockType: "paragraph",
        content: { text: "Updated body" },
      },
    ],
  });
  expect(element(elements, "#page-body").value).toBe("Canonical body");
  expect(element(elements, "#body-status").textContent).toBe(
    "Page body saved.",
  );

  element(elements, "#page-body").value = "Second body";
  await element(elements, "#save-body").emit("click");
  const bodyWrites = apiFetch.mock.calls.filter(
    ([url, options]) =>
      url === "/api/v1/pages/page-1/blocks" &&
      (options as { method?: string }).method === "PUT",
  );
  expect(bodyWrites).toHaveLength(2);
  expect(bodyWrites[1]?.[1]).toMatchObject({
    headers: { "if-match": '"4"' },
  });
  expect(element(elements, "#page-body").value).toBe("Second body");

  element(elements, "#page-title").value = "Renamed Projects";
  await element(elements, "#save-page").emit("click");
  const titleWrite = apiFetch.mock.calls.find(
    ([url, options]) =>
      url === "/api/v1/pages/page-1" &&
      (options as { method?: string }).method === "PATCH",
  );
  expect(titleWrite?.[1]).toMatchObject({
    headers: {
      "if-match": "7",
      "x-pos-csrf": "csrf-token",
    },
  });
});

test("browser disables body mutation instead of replacing an unsupported document", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const apiFetch = vi.fn((url: string) => {
    if (url === "/api/v1/auth/session") {
      return Promise.resolve(jsonResponse({ authenticated: true }));
    }
    if (url === "/api/v1/pages") {
      return Promise.resolve(
        jsonResponse({ pages: [livePage("page-1", "Projects")] }),
      );
    }
    if (url === "/api/v1/pages/page-1") {
      return Promise.resolve(
        jsonResponse({
          page: livePage("page-1", "Projects"),
          revisionNumber: 1,
        }),
      );
    }
    if (url === "/api/v1/pages/page-1/blocks") {
      return Promise.resolve(
        jsonResponse({
          document: {
            pageId: "page-1",
            revisionNumber: 3,
            blocks: [
              {
                id: "root-1",
                parentBlockId: null,
                blockType: "paragraph",
                position: 0,
                content: { text: "Root" },
              },
              {
                id: "child-1",
                parentBlockId: "root-1",
                blockType: "paragraph",
                position: 0,
                content: { text: "Child" },
              },
            ],
          },
        }),
      );
    }
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  await pageListButton(elements).emit("click");

  expect(element(elements, "#page-body").disabled).toBe(true);
  expect(element(elements, "#save-body").disabled).toBe(true);
  expect(element(elements, "#page-body").value).toBe("");
  expect(element(elements, "#body-status").textContent).toBe(
    "This page body cannot be edited in this version.",
  );
  await element(elements, "#save-body").emit("click");
  expect(
    apiFetch.mock.calls.filter(
      ([url]) => url === "/api/v1/pages/page-1/blocks",
    ),
  ).toHaveLength(1);
});

test("browser retains draft text and prompts reload on a body conflict", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const apiFetch = vi.fn((url: string, options?: { method?: string }) => {
    if (url === "/api/v1/auth/session") {
      return Promise.resolve(jsonResponse({ authenticated: true }));
    }
    if (url === "/api/v1/pages") {
      return Promise.resolve(
        jsonResponse({ pages: [livePage("page-1", "Projects")] }),
      );
    }
    if (url === "/api/v1/pages/page-1" && options?.method === "GET") {
      return Promise.resolve(
        jsonResponse({
          page: livePage("page-1", "Projects"),
          revisionNumber: 1,
        }),
      );
    }
    if (url === "/api/v1/pages/page-1/blocks" && options?.method === "GET") {
      return Promise.resolve(
        jsonResponse({
          document: {
            pageId: "page-1",
            revisionNumber: 3,
            blocks: [
              {
                id: "block-1",
                parentBlockId: null,
                blockType: "paragraph",
                position: 0,
                content: { text: "Saved body" },
              },
            ],
          },
        }),
      );
    }
    if (url === "/api/v1/pages/page-1/blocks" && options?.method === "PUT") {
      return Promise.resolve(
        jsonResponse({ error: "block document revision conflict" }, 409),
      );
    }
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  await pageListButton(elements).emit("click");
  element(elements, "#page-body").value = "My unsaved body";
  await element(elements, "#save-body").emit("click");

  expect(element(elements, "#page-body").value).toBe("My unsaved body");
  expect(element(elements, "#body-status").textContent).toBe(
    "This page body changed. Reload the page before saving.",
  );
});

test("browser ignores a late body response after selecting another page", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const firstBody = createDeferred<Response>();
  let firstBodyRequested!: () => void;
  const firstBodyStarted = new Promise<void>((resolve) => {
    firstBodyRequested = resolve;
  });
  const apiFetch = vi.fn((url: string) => {
    if (url === "/api/v1/auth/session") {
      return Promise.resolve(jsonResponse({ authenticated: true }));
    }
    if (url === "/api/v1/pages") {
      return Promise.resolve(
        jsonResponse({
          pages: [livePage("page-1", "First"), livePage("page-2", "Second")],
        }),
      );
    }
    if (url === "/api/v1/pages/page-1") {
      return Promise.resolve(
        jsonResponse({
          page: livePage("page-1", "First"),
          revisionNumber: 1,
        }),
      );
    }
    if (url === "/api/v1/pages/page-1/blocks") {
      firstBodyRequested();
      return firstBody.promise;
    }
    if (url === "/api/v1/pages/page-2") {
      return Promise.resolve(
        jsonResponse({
          page: livePage("page-2", "Second"),
          revisionNumber: 2,
        }),
      );
    }
    if (url === "/api/v1/pages/page-2/blocks") {
      return Promise.resolve(
        jsonResponse({
          document: {
            pageId: "page-2",
            revisionNumber: 5,
            blocks: [
              {
                id: "block-2",
                parentBlockId: null,
                blockType: "paragraph",
                position: 0,
                content: { text: "Second body" },
              },
            ],
          },
        }),
      );
    }
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  const selectingFirst = pageListButton(elements, 0).emit("click");
  await firstBodyStarted;
  await pageListButton(elements, 1).emit("click");
  firstBody.resolve(
    jsonResponse({
      document: {
        pageId: "page-1",
        revisionNumber: 4,
        blocks: [
          {
            id: "block-1",
            parentBlockId: null,
            blockType: "paragraph",
            position: 0,
            content: { text: "First body" },
          },
        ],
      },
    }),
  );
  await selectingFirst;

  expect(element(elements, "#page-title").value).toBe("Second");
  expect(element(elements, "#page-body").value).toBe("Second body");
});

test("browser renders a validated nested tree and breadcrumbs for a selected child", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const root = livePage("root", "Root");
  const child = livePage("child", "Child", "root");
  const leaf = livePage("leaf", "Leaf", "child");
  const apiFetch = vi.fn((url: string) => {
    if (url === "/api/v1/auth/session") {
      return Promise.resolve(jsonResponse({ authenticated: true }));
    }
    if (url === "/api/v1/pages") {
      return Promise.resolve(jsonResponse({ pages: [root, child, leaf] }));
    }
    if (url === "/api/v1/pages/child") {
      return Promise.resolve(jsonResponse({ page: child, revisionNumber: 4 }));
    }
    if (url === "/api/v1/pages/child/blocks") {
      return Promise.resolve(
        jsonResponse({
          document: { blocks: [], pageId: "child", revisionNumber: 0 },
        }),
      );
    }
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);

  expect(
    navigationButtons(element(elements, "#page-list")).map(
      (button) => button.textContent,
    ),
  ).toEqual(["Root", "Child", "Leaf"]);
  const rootItem = element(elements, "#page-list").children[0];
  expect(rootItem?.tagName).toBe("li");
  expect(rootItem?.children[1]?.tagName).toBe("ul");

  await pageListButton(elements, 1).emit("click");

  expect(element(elements, "#breadcrumbs").textContent).toBe("Root / Child");
  expect(
    element(elements, "#page-parent").children.map((option) => option.value),
  ).toEqual(["", "root"]);
});

test("browser creates a child page under the selected live parent", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const root = livePage("root", "Root");
  const child = livePage("child", "Child", "root");
  let pageListReads = 0;
  const apiFetch = vi.fn((url: string, options?: { method?: string }) => {
    if (url === "/api/v1/auth/session") {
      return Promise.resolve(jsonResponse({ authenticated: true }));
    }
    if (url === "/api/v1/pages" && options?.method === "GET") {
      pageListReads += 1;
      return Promise.resolve(
        jsonResponse({ pages: pageListReads === 1 ? [root] : [root, child] }),
      );
    }
    if (url === "/api/v1/pages/root") {
      return Promise.resolve(jsonResponse({ page: root, revisionNumber: 1 }));
    }
    if (url === "/api/v1/pages/root/blocks") {
      return Promise.resolve(
        jsonResponse({
          document: { blocks: [], pageId: "root", revisionNumber: 0 },
        }),
      );
    }
    if (url === "/api/v1/pages" && options?.method === "POST") {
      return Promise.resolve(
        jsonResponse({ page: child, revisionNumber: 1 }, 201),
      );
    }
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  await pageListButton(elements).emit("click");
  element(elements, "#new-child-page-title").value = "Child";
  await element(elements, "#create-child-page").emit("submit");

  const createCall = apiFetch.mock.calls.find(
    ([url, options]) =>
      url === "/api/v1/pages" &&
      (options as { method?: string }).method === "POST",
  );
  expect(createCall?.[1]).toMatchObject({
    body: JSON.stringify({ title: "Child", parentId: "root" }),
  });
  expect(element(elements, "#page-title").value).toBe("Child");
  expect(
    navigationButtons(element(elements, "#page-list")).map(
      (button) => button.textContent,
    ),
  ).toEqual(["Root", "Child"]);
});

test("browser moves a live page and preserves a parent draft on a metadata conflict", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const root = livePage("root", "Root");
  const otherRoot = livePage("other-root", "Other root");
  const child = livePage("child", "Child", "root");
  const movedChild = livePage("child", "Child", "other-root");
  let moveAttempts = 0;
  let pageListReads = 0;
  const apiFetch = vi.fn((url: string, options?: { method?: string }) => {
    if (url === "/api/v1/auth/session") {
      return Promise.resolve(jsonResponse({ authenticated: true }));
    }
    if (url === "/api/v1/pages" && options?.method === "GET") {
      pageListReads += 1;
      return Promise.resolve(
        jsonResponse({
          pages:
            pageListReads === 1
              ? [root, otherRoot, child]
              : [root, otherRoot, movedChild],
        }),
      );
    }
    if (url === "/api/v1/pages/child" && options?.method === "GET") {
      return Promise.resolve(jsonResponse({ page: child, revisionNumber: 1 }));
    }
    if (url === "/api/v1/pages/child/blocks") {
      return Promise.resolve(
        jsonResponse({
          document: { blocks: [], pageId: "child", revisionNumber: 0 },
        }),
      );
    }
    if (url === "/api/v1/pages/child/parent" && options?.method === "PUT") {
      moveAttempts += 1;
      return Promise.resolve(
        moveAttempts === 1
          ? jsonResponse({ error: "page revision conflict" }, 409)
          : jsonResponse({ page: movedChild, revisionNumber: 2 }),
      );
    }
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  await pageListButton(elements, 1).emit("click");
  const parentSelector = element(elements, "#page-parent");
  parentSelector.value = "other-root";

  await element(elements, "#save-parent").emit("click");

  expect(parentSelector.value).toBe("other-root");
  expect(element(elements, "#status").textContent).toBe(
    "This page changed. Reload the page before moving it.",
  );

  await element(elements, "#save-parent").emit("click");

  const moveCalls = apiFetch.mock.calls.filter(
    ([url, options]) =>
      url === "/api/v1/pages/child/parent" &&
      (options as { method?: string }).method === "PUT",
  );
  expect(moveCalls).toHaveLength(2);
  expect(moveCalls[1]?.[1]).toMatchObject({
    body: JSON.stringify({ parentId: "other-root" }),
    headers: { "if-match": "1", "x-pos-csrf": "csrf-token" },
  });
  expect(element(elements, "#status").textContent).toBe("Page moved.");
});

test("browser archives a selected leaf without exposing it in ordinary navigation", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const root = livePage("root", "Root");
  const leaf = livePage("leaf", "Leaf", "root");
  const archivedLeaf = archivedPage("leaf", "Leaf", "root");
  let activeReads = 0;
  const apiFetch = vi.fn((url: string, options?: { method?: string }) => {
    if (url === "/api/v1/auth/session") {
      return Promise.resolve(jsonResponse({ authenticated: true }));
    }
    if (url === "/api/v1/pages" && options?.method === "GET") {
      activeReads += 1;
      return Promise.resolve(
        jsonResponse({ pages: activeReads === 1 ? [root, leaf] : [root] }),
      );
    }
    if (url === "/api/v1/pages/leaf" && options?.method === "GET") {
      return Promise.resolve(jsonResponse({ page: leaf, revisionNumber: 1 }));
    }
    if (url === "/api/v1/pages/leaf/blocks") {
      return Promise.resolve(
        jsonResponse({
          document: {
            blocks: [
              {
                blockType: "paragraph",
                content: { text: "Read only after archive" },
                id: "leaf-block",
                parentBlockId: null,
                position: 0,
              },
            ],
            pageId: "leaf",
            revisionNumber: 2,
          },
        }),
      );
    }
    if (url === "/api/v1/pages/leaf/archive") {
      return Promise.resolve(
        jsonResponse({ page: archivedLeaf, revisionNumber: 2 }),
      );
    }
    if (url === "/api/v1/pages?archived=only") {
      return Promise.resolve(jsonResponse({ pages: [archivedLeaf] }));
    }
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  await pageListButton(elements, 1).emit("click");
  await element(elements, "#archive-page").emit("click");

  expect(
    navigationButtons(element(elements, "#page-list")).map(
      (button) => button.textContent,
    ),
  ).toEqual(["Root"]);
  expect(element(elements, "#page-title").disabled).toBe(true);
  expect(element(elements, "#save-page").disabled).toBe(true);
  expect(element(elements, "#new-child-page-title").disabled).toBe(true);
  expect(element(elements, "#page-parent").disabled).toBe(false);
  expect(element(elements, "#save-parent").disabled).toBe(true);
  expect(element(elements, "#page-body").value).toBe("Read only after archive");
  expect(element(elements, "#page-body").disabled).toBe(true);
  expect(element(elements, "#save-body").disabled).toBe(true);
  expect(element(elements, "#restore-page").hidden).toBe(false);
  expect(
    apiFetch.mock.calls.filter(
      ([url]) => url === "/api/v1/pages?archived=only",
    ),
  ).toHaveLength(0);

  await element(elements, "#show-archived-pages").emit("click");

  expect(element(elements, "#archived-pages").hidden).toBe(false);
  expect(
    navigationButtons(element(elements, "#archived-page-list")).map(
      (button) => button.textContent,
    ),
  ).toEqual(["Leaf"]);
});

test("browser reconciles active navigation when an archive resolves after a newer selection", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const first = livePage("first", "First");
  const second = livePage("second", "Second");
  const archivedFirst = archivedPage("first", "First");
  const archiveResponse = createDeferred<Response>();
  let archiveRequested!: () => void;
  const archiveStarted = new Promise<void>((resolve) => {
    archiveRequested = resolve;
  });
  let activeReads = 0;
  const apiFetch = vi.fn((url: string, options?: { method?: string }) => {
    if (url === "/api/v1/auth/session") {
      return Promise.resolve(jsonResponse({ authenticated: true }));
    }
    if (url === "/api/v1/pages" && options?.method === "GET") {
      activeReads += 1;
      return Promise.resolve(
        jsonResponse({ pages: activeReads === 1 ? [first, second] : [second] }),
      );
    }
    if (url === "/api/v1/pages/first" && options?.method === "GET") {
      return Promise.resolve(jsonResponse({ page: first, revisionNumber: 1 }));
    }
    if (url === "/api/v1/pages/second" && options?.method === "GET") {
      return Promise.resolve(jsonResponse({ page: second, revisionNumber: 1 }));
    }
    if (
      (url === "/api/v1/pages/first/blocks" ||
        url === "/api/v1/pages/second/blocks") &&
      options?.method === "GET"
    ) {
      return Promise.resolve(
        jsonResponse({
          document: {
            blocks: [],
            pageId: url.includes("first") ? "first" : "second",
            revisionNumber: 0,
          },
        }),
      );
    }
    if (url === "/api/v1/pages/first/archive") {
      archiveRequested();
      return archiveResponse.promise;
    }
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  await pageListButton(elements).emit("click");
  const archiving = element(elements, "#archive-page").emit("click");
  await archiveStarted;
  await pageListButton(elements, 1).emit("click");
  element(elements, "#page-title").value = "Second draft";
  archiveResponse.resolve(
    jsonResponse({ page: archivedFirst, revisionNumber: 2 }),
  );
  await archiving;

  expect(element(elements, "#page-title").value).toBe("Second draft");
  expect(
    navigationButtons(element(elements, "#page-list")).map(
      (button) => button.textContent,
    ),
  ).toEqual(["Second"]);
});

test("browser preserves an unsaved title draft when an archive response resolves", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const root = livePage("root", "Root");
  const archivedRoot = archivedPage("root", "Root");
  const archiveResponse = createDeferred<Response>();
  let archiveRequested!: () => void;
  const archiveStarted = new Promise<void>((resolve) => {
    archiveRequested = resolve;
  });
  let activeReads = 0;
  const apiFetch = vi.fn((url: string, options?: { method?: string }) => {
    if (url === "/api/v1/auth/session") {
      return Promise.resolve(jsonResponse({ authenticated: true }));
    }
    if (url === "/api/v1/pages" && options?.method === "GET") {
      activeReads += 1;
      return Promise.resolve(
        jsonResponse({ pages: activeReads === 1 ? [root] : [] }),
      );
    }
    if (url === "/api/v1/pages/root" && options?.method === "GET") {
      return Promise.resolve(jsonResponse({ page: root, revisionNumber: 1 }));
    }
    if (url === "/api/v1/pages/root/blocks" && options?.method === "GET") {
      return Promise.resolve(
        jsonResponse({
          document: { blocks: [], pageId: "root", revisionNumber: 0 },
        }),
      );
    }
    if (url === "/api/v1/pages/root/archive") {
      archiveRequested();
      return archiveResponse.promise;
    }
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  await pageListButton(elements).emit("click");
  const archiving = element(elements, "#archive-page").emit("click");
  await archiveStarted;
  element(elements, "#page-title").value = "Unsent title draft";
  archiveResponse.resolve(
    jsonResponse({ page: archivedRoot, revisionNumber: 2 }),
  );
  await archiving;

  expect(element(elements, "#page-title").value).toBe("Unsent title draft");
});

test("browser reconciles active navigation when a move resolves after a newer selection", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const first = livePage("first", "First");
  const second = livePage("second", "Second");
  const movedFirst = livePage("first", "Moved first", "second");
  const moveResponse = createDeferred<Response>();
  let moveRequested!: () => void;
  const moveStarted = new Promise<void>((resolve) => {
    moveRequested = resolve;
  });
  let activeReads = 0;
  const apiFetch = vi.fn((url: string, options?: { method?: string }) => {
    if (url === "/api/v1/auth/session") {
      return Promise.resolve(jsonResponse({ authenticated: true }));
    }
    if (url === "/api/v1/pages" && options?.method === "GET") {
      activeReads += 1;
      return Promise.resolve(
        jsonResponse({
          pages: activeReads === 1 ? [first, second] : [second, movedFirst],
        }),
      );
    }
    if (url === "/api/v1/pages/first" && options?.method === "GET") {
      return Promise.resolve(jsonResponse({ page: first, revisionNumber: 1 }));
    }
    if (url === "/api/v1/pages/second" && options?.method === "GET") {
      return Promise.resolve(jsonResponse({ page: second, revisionNumber: 1 }));
    }
    if (
      (url === "/api/v1/pages/first/blocks" ||
        url === "/api/v1/pages/second/blocks") &&
      options?.method === "GET"
    ) {
      return Promise.resolve(
        jsonResponse({
          document: {
            blocks: [],
            pageId: url.includes("first") ? "first" : "second",
            revisionNumber: 0,
          },
        }),
      );
    }
    if (url === "/api/v1/pages/first/parent") {
      moveRequested();
      return moveResponse.promise;
    }
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  await pageListButton(elements).emit("click");
  element(elements, "#page-parent").value = "second";
  const moving = element(elements, "#save-parent").emit("click");
  await moveStarted;
  await pageListButton(elements, 1).emit("click");
  element(elements, "#page-title").value = "Second draft";
  moveResponse.resolve(jsonResponse({ page: movedFirst, revisionNumber: 2 }));
  await moving;

  expect(element(elements, "#page-title").value).toBe("Second draft");
  expect(
    navigationButtons(element(elements, "#page-list")).map(
      (button) => button.textContent,
    ),
  ).toEqual(["Second", "Moved first"]);
});

test("browser reconciles active navigation when a title save resolves after a newer selection", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const first = livePage("first", "First");
  const renamedFirst = livePage("first", "Renamed first");
  const second = livePage("second", "Second");
  const saveResponse = createDeferred<Response>();
  let saveRequested!: () => void;
  const saveStarted = new Promise<void>((resolve) => {
    saveRequested = resolve;
  });
  let activeReads = 0;
  const apiFetch = vi.fn((url: string, options?: { method?: string }) => {
    if (url === "/api/v1/auth/session") {
      return Promise.resolve(jsonResponse({ authenticated: true }));
    }
    if (url === "/api/v1/pages" && options?.method === "GET") {
      activeReads += 1;
      return Promise.resolve(
        jsonResponse({
          pages: activeReads === 1 ? [first, second] : [renamedFirst, second],
        }),
      );
    }
    if (url === "/api/v1/pages/first" && options?.method === "GET") {
      return Promise.resolve(jsonResponse({ page: first, revisionNumber: 1 }));
    }
    if (url === "/api/v1/pages/second" && options?.method === "GET") {
      return Promise.resolve(jsonResponse({ page: second, revisionNumber: 1 }));
    }
    if (
      (url === "/api/v1/pages/first/blocks" ||
        url === "/api/v1/pages/second/blocks") &&
      options?.method === "GET"
    ) {
      return Promise.resolve(
        jsonResponse({
          document: {
            blocks: [],
            pageId: url.includes("first") ? "first" : "second",
            revisionNumber: 0,
          },
        }),
      );
    }
    if (url === "/api/v1/pages/first" && options?.method === "PATCH") {
      saveRequested();
      return saveResponse.promise;
    }
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  await pageListButton(elements).emit("click");
  element(elements, "#page-title").value = "Renamed first";
  const saving = element(elements, "#save-page").emit("click");
  await saveStarted;
  await pageListButton(elements, 1).emit("click");
  element(elements, "#page-title").value = "Second draft";
  saveResponse.resolve(jsonResponse({ page: renamedFirst, revisionNumber: 2 }));
  await saving;

  expect(element(elements, "#page-title").value).toBe("Second draft");
  expect(
    navigationButtons(element(elements, "#page-list")).map(
      (button) => button.textContent,
    ),
  ).toEqual(["Renamed first", "Second"]);
});

test("browser reconciles active navigation when a restore resolves after a newer selection", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const second = livePage("second", "Second");
  const archivedFirst = archivedPage("first", "First");
  const restoredFirst = livePage("first", "Restored first");
  const restoreResponse = createDeferred<Response>();
  let restoreRequested!: () => void;
  const restoreStarted = new Promise<void>((resolve) => {
    restoreRequested = resolve;
  });
  let activeReads = 0;
  let archivedReads = 0;
  const apiFetch = vi.fn((url: string, options?: { method?: string }) => {
    if (url === "/api/v1/auth/session") {
      return Promise.resolve(jsonResponse({ authenticated: true }));
    }
    if (url === "/api/v1/pages" && options?.method === "GET") {
      activeReads += 1;
      return Promise.resolve(
        jsonResponse({
          pages: activeReads === 1 ? [second] : [second, restoredFirst],
        }),
      );
    }
    if (url === "/api/v1/pages?archived=only") {
      archivedReads += 1;
      return Promise.resolve(
        jsonResponse({ pages: archivedReads === 1 ? [archivedFirst] : [] }),
      );
    }
    if (url === "/api/v1/pages/first" && options?.method === "GET") {
      return Promise.resolve(
        jsonResponse({ page: archivedFirst, revisionNumber: 1 }),
      );
    }
    if (url === "/api/v1/pages/second" && options?.method === "GET") {
      return Promise.resolve(jsonResponse({ page: second, revisionNumber: 1 }));
    }
    if (
      (url === "/api/v1/pages/first/blocks" ||
        url === "/api/v1/pages/second/blocks") &&
      options?.method === "GET"
    ) {
      return Promise.resolve(
        jsonResponse({
          document: {
            blocks: [],
            pageId: url.includes("first") ? "first" : "second",
            revisionNumber: 0,
          },
        }),
      );
    }
    if (url === "/api/v1/pages/first/restore") {
      restoreRequested();
      return restoreResponse.promise;
    }
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  await element(elements, "#show-archived-pages").emit("click");
  await archivedPageListButton(elements).emit("click");
  const restoring = element(elements, "#restore-page").emit("click");
  await restoreStarted;
  await pageListButton(elements).emit("click");
  element(elements, "#page-title").value = "Second draft";
  restoreResponse.resolve(
    jsonResponse({ page: restoredFirst, revisionNumber: 2 }),
  );
  await restoring;

  expect(element(elements, "#page-title").value).toBe("Second draft");
  expect(
    navigationButtons(element(elements, "#page-list")).map(
      (button) => button.textContent,
    ),
  ).toEqual(["Second", "Restored first"]);
  expect(navigationButtons(element(elements, "#archived-page-list"))).toEqual(
    [],
  );
});

test("browser restores an archived page only to the root or a live parent", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const root = livePage("root", "Root");
  const archivedParent = archivedPage("archived-parent", "Archived parent");
  const archivedChild = archivedPage(
    "archived-child",
    "Archived child",
    "archived-parent",
  );
  const restoredChild = livePage("archived-child", "Archived child", "root");
  let activeReads = 0;
  let restoreAttempts = 0;
  const apiFetch = vi.fn((url: string, options?: { method?: string }) => {
    if (url === "/api/v1/auth/session") {
      return Promise.resolve(jsonResponse({ authenticated: true }));
    }
    if (url === "/api/v1/pages" && options?.method === "GET") {
      activeReads += 1;
      return Promise.resolve(
        jsonResponse({
          pages: activeReads === 1 ? [root] : [root, restoredChild],
        }),
      );
    }
    if (url === "/api/v1/pages?archived=only") {
      return Promise.resolve(
        jsonResponse({ pages: [archivedParent, archivedChild] }),
      );
    }
    if (url === "/api/v1/pages/archived-child") {
      return Promise.resolve(
        jsonResponse({ page: archivedChild, revisionNumber: 7 }),
      );
    }
    if (url === "/api/v1/pages/archived-child/blocks") {
      return Promise.resolve(
        jsonResponse({
          document: { blocks: [], pageId: "archived-child", revisionNumber: 0 },
        }),
      );
    }
    if (url === "/api/v1/pages/archived-child/restore") {
      restoreAttempts += 1;
      return Promise.resolve(
        restoreAttempts === 1
          ? jsonResponse({ error: "invalid page hierarchy" }, 400)
          : jsonResponse({ page: restoredChild, revisionNumber: 8 }),
      );
    }
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  await element(elements, "#show-archived-pages").emit("click");
  await archivedPageListButton(elements, 1).emit("click");

  const parentSelector = element(elements, "#page-parent");
  expect(parentSelector.children.map((option) => option.value)).toEqual([
    "",
    "root",
  ]);
  expect(element(elements, "#page-title").disabled).toBe(true);

  parentSelector.value = "root";
  await element(elements, "#restore-page").emit("click");

  expect(parentSelector.value).toBe("root");
  expect(element(elements, "#status").textContent).toBe(
    "Could not restore page.",
  );

  await element(elements, "#restore-page").emit("click");

  const restoreCalls = apiFetch.mock.calls.filter(
    ([url]) => url === "/api/v1/pages/archived-child/restore",
  );
  expect(restoreCalls).toHaveLength(2);
  expect(restoreCalls[1]?.[1]).toMatchObject({
    body: JSON.stringify({ parentId: "root" }),
    headers: { "if-match": "7", "x-pos-csrf": "csrf-token" },
  });
  expect(element(elements, "#page-title").disabled).toBe(false);
  expect(element(elements, "#page-body").disabled).toBe(false);
  expect(element(elements, "#restore-page").hidden).toBe(true);
  expect(
    navigationButtons(element(elements, "#page-list")).map(
      (button) => button.textContent,
    ),
  ).toEqual(["Root", "Archived child"]);
});

test("browser fails closed with generic feedback when archived navigation is unavailable", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const root = livePage("root", "Root");
  const apiFetch = vi.fn((url: string) => {
    if (url === "/api/v1/auth/session") {
      return Promise.resolve(jsonResponse({ authenticated: true }));
    }
    if (url === "/api/v1/pages") {
      return Promise.resolve(jsonResponse({ pages: [root] }));
    }
    if (url === "/api/v1/pages?archived=only") {
      return Promise.resolve(jsonResponse({ error: "storage details" }, 500));
    }
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  await element(elements, "#show-archived-pages").emit("click");

  expect(element(elements, "#workspace").hidden).toBe(false);
  expect(element(elements, "#status").textContent).toBe(
    "Could not load archived pages.",
  );
  expect(element(elements, "#status").textContent).not.toContain(
    "storage details",
  );
});

test("browser ignores a late active navigation response after a newer refresh", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const root = livePage("root", "Root");
  const renamedRoot = livePage("root", "Renamed root");
  const freshChild = livePage("fresh-child", "Fresh child", "root");
  const staleRefresh = createDeferred<Response>();
  let staleRefreshRequested!: () => void;
  const staleRefreshStarted = new Promise<void>((resolve) => {
    staleRefreshRequested = resolve;
  });
  let activeReads = 0;
  const apiFetch = vi.fn((url: string, options?: { method?: string }) => {
    if (url === "/api/v1/auth/session") {
      return Promise.resolve(jsonResponse({ authenticated: true }));
    }
    if (url === "/api/v1/pages" && options?.method === "GET") {
      activeReads += 1;
      if (activeReads === 1)
        return Promise.resolve(jsonResponse({ pages: [root] }));
      if (activeReads === 2) {
        staleRefreshRequested();
        return staleRefresh.promise;
      }
      return Promise.resolve(
        jsonResponse({ pages: [renamedRoot, freshChild] }),
      );
    }
    if (url === "/api/v1/pages/root" && options?.method === "GET") {
      return Promise.resolve(jsonResponse({ page: root, revisionNumber: 1 }));
    }
    if (url === "/api/v1/pages/root/blocks") {
      return Promise.resolve(
        jsonResponse({
          document: { blocks: [], pageId: "root", revisionNumber: 0 },
        }),
      );
    }
    if (url === "/api/v1/pages/root" && options?.method === "PATCH") {
      return Promise.resolve(
        jsonResponse({ page: renamedRoot, revisionNumber: 2 }),
      );
    }
    if (url === "/api/v1/pages" && options?.method === "POST") {
      return Promise.resolve(
        jsonResponse({ page: freshChild, revisionNumber: 1 }, 201),
      );
    }
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  await pageListButton(elements).emit("click");
  element(elements, "#page-title").value = "Renamed root";
  const saving = element(elements, "#save-page").emit("click");
  await staleRefreshStarted;
  element(elements, "#new-child-page-title").value = "Fresh child";
  await element(elements, "#create-child-page").emit("submit");
  staleRefresh.resolve(jsonResponse({ pages: [root] }));
  await saving;

  expect(
    navigationButtons(element(elements, "#page-list")).map(
      (button) => button.textContent,
    ),
  ).toEqual(["Renamed root", "Fresh child"]);
});

test("browser ignores a late archived list after a newer page selection", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const root = livePage("root", "Root");
  const staleArchived = archivedPage("stale-archived", "Stale archived");
  const archivedList = createDeferred<Response>();
  let archivedRequested!: () => void;
  const archivedStarted = new Promise<void>((resolve) => {
    archivedRequested = resolve;
  });
  const apiFetch = vi.fn((url: string) => {
    if (url === "/api/v1/auth/session") {
      return Promise.resolve(jsonResponse({ authenticated: true }));
    }
    if (url === "/api/v1/pages") {
      return Promise.resolve(jsonResponse({ pages: [root] }));
    }
    if (url === "/api/v1/pages?archived=only") {
      archivedRequested();
      return archivedList.promise;
    }
    if (url === "/api/v1/pages/root") {
      return Promise.resolve(jsonResponse({ page: root, revisionNumber: 1 }));
    }
    if (url === "/api/v1/pages/root/blocks") {
      return Promise.resolve(
        jsonResponse({
          document: { blocks: [], pageId: "root", revisionNumber: 0 },
        }),
      );
    }
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  const openingArchived = element(elements, "#show-archived-pages").emit(
    "click",
  );
  await archivedStarted;
  await pageListButton(elements).emit("click");
  archivedList.resolve(jsonResponse({ pages: [staleArchived] }));
  await openingArchived;

  expect(element(elements, "#page-title").value).toBe("Root");
  expect(navigationButtons(element(elements, "#archived-page-list"))).toEqual(
    [],
  );
});

test("browser re-enables metadata controls after selecting another page during a pending save", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const first = livePage("first", "First");
  const second = livePage("second", "Second");
  const firstSave = createDeferred<Response>();
  let saveRequested!: () => void;
  const saveStarted = new Promise<void>((resolve) => {
    saveRequested = resolve;
  });
  const apiFetch = vi.fn((url: string, options?: { method?: string }) => {
    if (url === "/api/v1/auth/session") {
      return Promise.resolve(jsonResponse({ authenticated: true }));
    }
    if (url === "/api/v1/pages" && options?.method === "GET") {
      return Promise.resolve(jsonResponse({ pages: [first, second] }));
    }
    if (url === "/api/v1/pages/first" && options?.method === "GET") {
      return Promise.resolve(jsonResponse({ page: first, revisionNumber: 1 }));
    }
    if (url === "/api/v1/pages/second" && options?.method === "GET") {
      return Promise.resolve(jsonResponse({ page: second, revisionNumber: 1 }));
    }
    if (
      (url === "/api/v1/pages/first/blocks" ||
        url === "/api/v1/pages/second/blocks") &&
      options?.method === "GET"
    ) {
      return Promise.resolve(
        jsonResponse({
          document: {
            blocks: [],
            pageId: url.includes("first") ? "first" : "second",
            revisionNumber: 0,
          },
        }),
      );
    }
    if (url === "/api/v1/pages/first" && options?.method === "PATCH") {
      saveRequested();
      return firstSave.promise;
    }
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  await pageListButton(elements).emit("click");
  element(elements, "#page-title").value = "Updated first";
  const saving = element(elements, "#save-page").emit("click");
  await saveStarted;
  await pageListButton(elements, 1).emit("click");

  expect(element(elements, "#page-title").value).toBe("Second");
  expect(element(elements, "#page-title").disabled).toBe(false);
  expect(element(elements, "#save-page").disabled).toBe(false);

  firstSave.resolve(jsonResponse({ page: first, revisionNumber: 2 }));
  await saving;
});

test("browser keeps an unsaved title draft after a successful page move", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const root = livePage("root", "Root");
  const otherRoot = livePage("other-root", "Other root");
  const child = livePage("child", "Child", "root");
  const movedChild = livePage("child", "Child", "other-root");
  let pageListReads = 0;
  const apiFetch = vi.fn((url: string, options?: { method?: string }) => {
    if (url === "/api/v1/auth/session") {
      return Promise.resolve(jsonResponse({ authenticated: true }));
    }
    if (url === "/api/v1/pages" && options?.method === "GET") {
      pageListReads += 1;
      return Promise.resolve(
        jsonResponse({
          pages:
            pageListReads === 1
              ? [root, otherRoot, child]
              : [root, otherRoot, movedChild],
        }),
      );
    }
    if (url === "/api/v1/pages/child" && options?.method === "GET") {
      return Promise.resolve(jsonResponse({ page: child, revisionNumber: 1 }));
    }
    if (url === "/api/v1/pages/child/blocks") {
      return Promise.resolve(
        jsonResponse({
          document: { blocks: [], pageId: "child", revisionNumber: 0 },
        }),
      );
    }
    if (url === "/api/v1/pages/child/parent" && options?.method === "PUT") {
      return Promise.resolve(
        jsonResponse({ page: movedChild, revisionNumber: 2 }),
      );
    }
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  await pageListButton(elements, 1).emit("click");
  element(elements, "#page-title").value = "Unsent title draft";
  element(elements, "#page-parent").value = "other-root";
  await element(elements, "#save-parent").emit("click");

  expect(element(elements, "#page-title").value).toBe("Unsent title draft");
  expect(element(elements, "#page-parent").value).toBe("other-root");
});

test("browser keeps an unsaved parent draft after a successful title save", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const root = livePage("root", "Root");
  const otherRoot = livePage("other-root", "Other root");
  const child = livePage("child", "Child", "root");
  const renamedChild = livePage("child", "Renamed child", "root");
  let pageListReads = 0;
  const apiFetch = vi.fn((url: string, options?: { method?: string }) => {
    if (url === "/api/v1/auth/session") {
      return Promise.resolve(jsonResponse({ authenticated: true }));
    }
    if (url === "/api/v1/pages" && options?.method === "GET") {
      pageListReads += 1;
      return Promise.resolve(
        jsonResponse({
          pages:
            pageListReads === 1
              ? [root, otherRoot, child]
              : [root, otherRoot, renamedChild],
        }),
      );
    }
    if (url === "/api/v1/pages/child" && options?.method === "GET") {
      return Promise.resolve(jsonResponse({ page: child, revisionNumber: 1 }));
    }
    if (url === "/api/v1/pages/child/blocks") {
      return Promise.resolve(
        jsonResponse({
          document: { blocks: [], pageId: "child", revisionNumber: 0 },
        }),
      );
    }
    if (url === "/api/v1/pages/child" && options?.method === "PATCH") {
      return Promise.resolve(
        jsonResponse({ page: renamedChild, revisionNumber: 2 }),
      );
    }
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  await pageListButton(elements, 1).emit("click");
  element(elements, "#page-parent").value = "other-root";
  element(elements, "#page-title").value = "Renamed child";
  await element(elements, "#save-page").emit("click");

  expect(element(elements, "#page-title").value).toBe("Renamed child");
  expect(element(elements, "#page-parent").value).toBe("other-root");
});

test("browser does not replace a newer selection when root creation resolves late", async () => {
  const { documentObject, elements } = createBrowserDocument();
  const first = livePage("first", "First");
  const second = livePage("second", "Second");
  const fresh = livePage("fresh", "Fresh");
  const rootCreate = createDeferred<Response>();
  let createRequested!: () => void;
  const createStarted = new Promise<void>((resolve) => {
    createRequested = resolve;
  });
  let pageListReads = 0;
  const apiFetch = vi.fn((url: string, options?: { method?: string }) => {
    if (url === "/api/v1/auth/session") {
      return Promise.resolve(jsonResponse({ authenticated: true }));
    }
    if (url === "/api/v1/pages" && options?.method === "GET") {
      pageListReads += 1;
      return Promise.resolve(
        jsonResponse({
          pages: pageListReads === 1 ? [first, second] : [first, second, fresh],
        }),
      );
    }
    if (url === "/api/v1/pages/second" && options?.method === "GET") {
      return Promise.resolve(jsonResponse({ page: second, revisionNumber: 1 }));
    }
    if (url === "/api/v1/pages/second/blocks") {
      return Promise.resolve(
        jsonResponse({
          document: { blocks: [], pageId: "second", revisionNumber: 0 },
        }),
      );
    }
    if (url === "/api/v1/pages" && options?.method === "POST") {
      createRequested();
      return rootCreate.promise;
    }
    throw new Error(`Unexpected browser request: ${url}`);
  });

  await startBrowserApp(documentObject, apiFetch as typeof fetch);
  element(elements, "#new-page-title").value = "Fresh";
  const creating = element(elements, "#create-page").emit("submit");
  await createStarted;
  await pageListButton(elements, 1).emit("click");
  element(elements, "#page-title").value = "Second draft";
  rootCreate.resolve(jsonResponse({ page: fresh, revisionNumber: 1 }, 201));
  await creating;

  expect(element(elements, "#page-title").value).toBe("Second draft");
  expect(
    navigationButtons(element(elements, "#page-list")).map(
      (button) => button.textContent,
    ),
  ).toEqual(["First", "Second", "Fresh"]);
});
