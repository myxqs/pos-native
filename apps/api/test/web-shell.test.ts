import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

import type { BrowserDocument, BrowserElement } from "../../web/app.js";
import {
  createPageRequest,
  getSessionRequest,
  loginRequest,
  logoutRequest,
  startBrowserApp,
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
