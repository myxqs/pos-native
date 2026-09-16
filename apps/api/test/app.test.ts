import { expect, test } from "vitest";

import { buildApp } from "../src/app.ts";

test("serves an unauthenticated health response without leaking configuration", async () => {
  const app = buildApp();
  const response = await app.inject({ method: "GET", url: "/health" });

  expect(response.statusCode).toBe(200);
  expect(response.headers["content-security-policy"]).toBeDefined();
  expect(response.json()).toEqual({ status: "ok", service: "pos-native-api" });
  await app.close();
});

test("serves a versioned system manifest", async () => {
  const app = buildApp();
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/system/manifest",
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    apiVersion: "v1",
    service: "pos-native-api",
    mutationAccess: "not-enabled",
  });
  await app.close();
});
