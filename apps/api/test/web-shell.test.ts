import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

import type { BrowserDocument, BrowserElement } from "../../web/app.js";
import {
  createPageRequest,
  getBlockDocumentRequest,
  getSessionRequest,
  loginRequest,
  logoutRequest,
  startBrowserApp,
  updateBlockDocumentRequest,
  updatePageRequest,
} from "../../web/app.js";
import { buildApp } from "../src/app.ts";

class FakeElement implements BrowserElement {
  children: FakeElement[] = [];
  disabled = false;
  hidden = false;
  textContent = "";
  type = "";
  value = "";
  #listeners = new Map<
    string,
    (event: { preventDefault(): void }) => void | Promise<void>
  >();

  addEventListener(
    type: string,
    listener: (event: { preventDefault(): void }) => void | Promise<void>,
  ): void {
    this.#listeners.set(type, listener);
  }

  append(child: FakeElement): void {
    this.children.push(child);
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

function createBrowserDocument(): {
  documentObject: BrowserDocument;
  elements: Record<string, FakeElement>;
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
    "#page-title",
    "#save-page",
    "#page-body",
    "#save-body",
    "#body-status",
    "#page-list",
    "#editor",
    "#empty-state",
    "#status",
  ];
  const elements: Record<string, FakeElement> = Object.fromEntries(
    selectors.map((selector) => [selector, new FakeElement()]),
  );
  return {
    documentObject: {
      cookie: "pos_csrf=csrf-token",
      createElement: () => new FakeElement(),
      querySelector: (selector: string) => elements[selector] ?? null,
    },
    elements,
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

function pageListButton(
  elements: Record<string, FakeElement>,
  index = 0,
): FakeElement {
  const item = element(elements, "#page-list").children[index];
  const button = item?.children[0];
  if (!button) throw new Error("Missing page list button");
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
        JSON.stringify({ page: { id: "page-1", title: "Domain" } }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ page: { id: "page-1", title: "Projects" } }),
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
        jsonResponse({ pages: [{ id: "page-1", title: "Projects" }] }),
      );
    }
    if (url === "/api/v1/pages/page-1") {
      return Promise.resolve(
        jsonResponse({
          page: { id: "page-1", title: "Projects" },
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
        jsonResponse({ pages: [{ id: "page-1", title: "Projects" }] }),
      );
    }
    if (url === "/api/v1/pages/page-1") {
      return Promise.resolve(
        jsonResponse({
          page: { id: "page-1", title: "Projects" },
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
        jsonResponse({ pages: [{ id: "page-1", title: "Projects" }] }),
      );
    }
    if (url === "/api/v1/pages/page-1" && options?.method === "GET") {
      return Promise.resolve(
        jsonResponse({
          page: { id: "page-1", title: "Projects" },
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
          page: { id: "page-1", title: "Renamed Projects" },
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
        jsonResponse({ pages: [{ id: "page-1", title: "Projects" }] }),
      );
    }
    if (url === "/api/v1/pages/page-1") {
      return Promise.resolve(
        jsonResponse({
          page: { id: "page-1", title: "Projects" },
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
        jsonResponse({ pages: [{ id: "page-1", title: "Projects" }] }),
      );
    }
    if (url === "/api/v1/pages/page-1" && options?.method === "GET") {
      return Promise.resolve(
        jsonResponse({
          page: { id: "page-1", title: "Projects" },
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
          pages: [
            { id: "page-1", title: "First" },
            { id: "page-2", title: "Second" },
          ],
        }),
      );
    }
    if (url === "/api/v1/pages/page-1") {
      return Promise.resolve(
        jsonResponse({
          page: { id: "page-1", title: "First" },
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
          page: { id: "page-2", title: "Second" },
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
