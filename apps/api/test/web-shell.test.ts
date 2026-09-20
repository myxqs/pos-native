import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

import { createPageRequest, updatePageRequest } from "../../web/app.js";
import { buildApp } from "../src/app.ts";

test("serves an accessible NativePOS browser shell", async () => {
  const app = buildApp();
  const response = await app.inject({ method: "GET", url: "/" });

  expect(response.statusCode).toBe(200);
  expect(response.headers["content-type"]).toContain("text/html");
  expect(response.body).toContain("<h1>NativePOS</h1>");
  expect(response.body).toContain('aria-label="Create page"');
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
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pos-csrf": "csrf-token",
    },
    body: JSON.stringify({ title: "Domain" }),
  });
  expect(apiFetch).toHaveBeenNthCalledWith(2, "/api/v1/pages/page-1", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "if-match": "1",
      "x-pos-csrf": "csrf-token",
    },
    body: JSON.stringify({ title: "Projects" }),
  });
});
