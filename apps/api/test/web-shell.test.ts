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

  await expect(createPageRequest(apiFetch, "Domain")).resolves.toMatchObject({
    page: { title: "Domain" },
  });
  await expect(
    updatePageRequest(apiFetch, "page-1", "Projects"),
  ).resolves.toMatchObject({ page: { title: "Projects" } });
  expect(apiFetch).toHaveBeenNthCalledWith(1, "/api/v1/pages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Domain" }),
  });
  expect(apiFetch).toHaveBeenNthCalledWith(2, "/api/v1/pages/page-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Projects" }),
  });
});
