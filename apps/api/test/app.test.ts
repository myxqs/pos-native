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

test("distinguishes liveness from readiness and protects operational status", async () => {
  const app = buildApp({
    readiness: {
      check: async () => ({ ready: false, schemaVersion: "incompatible" }),
    },
    runtimeProfile: "production-local",
    applicationVersion: "0.1.0-test",
    startedAt: new Date("2026-09-29T12:00:00.000Z"),
    now: () => new Date("2026-09-29T12:00:05.000Z"),
    authorize: async () => ({
      ok: true,
      actor: {
        actorType: "api-token",
        actorId: "test",
        source: "machine-api",
      },
    }),
  });
  const live = await app.inject({ method: "GET", url: "/health" });
  const ready = await app.inject({ method: "GET", url: "/ready" });
  const status = await app.inject({
    method: "GET",
    url: "/api/v1/system/status",
  });
  expect(live.statusCode).toBe(200);
  expect(ready.statusCode).toBe(503);
  expect(ready.json()).toEqual({ status: "not-ready" });
  expect(status.json()).toEqual({
    applicationVersion: "0.1.0-test",
    profile: "production-local",
    uptimeSeconds: 5,
    ready: false,
    schemaVersion: "incompatible",
  });
  await app.close();
});
