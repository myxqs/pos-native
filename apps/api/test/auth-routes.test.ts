import { expect, test } from "vitest";

import { hashPassword } from "../../../packages/auth/src/password.ts";
import {
  AuthenticationService,
  InMemoryAuthenticationStore,
} from "../../../packages/auth/src/session.ts";
import { InMemoryPageRepository } from "../../../packages/database/src/page-repository.ts";
import { logoutRequest } from "../../web/app.js";
import { buildApp } from "../src/app.ts";

async function authenticatedApp() {
  const store = new InMemoryAuthenticationStore([
    {
      id: "11111111-1111-4111-8111-111111111111",
      email: "owner@example.test",
      passwordHash: await hashPassword("correct horse battery staple"),
    },
  ]);
  const rawTokens = ["session-token", "csrf-token"];
  return buildApp({
    authenticationService: new AuthenticationService(store, {
      now: () => new Date("2026-09-16T12:00:00.000Z"),
      randomToken: () => rawTokens.shift() ?? "",
      sessionId: () => "22222222-2222-4222-8222-222222222222",
    }),
    secureCookies: true,
    pageRepository: new InMemoryPageRepository(),
    pageDependencies: {
      newId: () => "33333333-3333-4333-8333-333333333333",
      now: () => new Date("2026-09-16T12:00:00.000Z"),
    },
  });
}

test("logs in with secure cookies and protects page writes with session plus CSRF", async () => {
  const app = await authenticatedApp();
  const unauthenticated = await app.inject({
    method: "POST",
    url: "/api/v1/pages",
    payload: { title: "Domain" },
  });
  expect(unauthenticated.statusCode).toBe(401);

  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: {
      email: "owner@example.test",
      password: "correct horse battery staple",
    },
  });
  expect(login.statusCode).toBe(200);
  const cookies = login.cookies;
  const session = cookies.find((cookie) => cookie.name === "pos_session");
  const csrf = cookies.find((cookie) => cookie.name === "pos_csrf");
  expect(session).toMatchObject({
    httpOnly: true,
    sameSite: "Strict",
    secure: true,
  });
  expect(csrf).toMatchObject({ sameSite: "Strict", secure: true });
  expect(csrf?.httpOnly).not.toBe(true);
  const cookieHeader = `pos_session=${session?.value}; pos_csrf=${csrf?.value}`;

  const missingCsrf = await app.inject({
    method: "POST",
    url: "/api/v1/pages",
    headers: { cookie: cookieHeader },
    payload: { title: "Domain" },
  });
  expect(missingCsrf.statusCode).toBe(403);

  const created = await app.inject({
    method: "POST",
    url: "/api/v1/pages",
    headers: { cookie: cookieHeader, "x-pos-csrf": csrf?.value ?? "" },
    payload: { title: "Domain" },
  });
  expect(created.statusCode).toBe(201);

  const sessionState = await app.inject({
    method: "GET",
    url: "/api/v1/auth/session",
    headers: { cookie: cookieHeader },
  });
  expect(sessionState.json()).toEqual({ authenticated: true });

  const logout = await app.inject({
    method: "POST",
    url: "/api/v1/auth/logout",
    headers: { cookie: cookieHeader, "x-pos-csrf": csrf?.value ?? "" },
  });
  expect(logout.statusCode).toBe(204);
  const afterLogout = await app.inject({
    method: "GET",
    url: "/api/v1/pages",
    headers: { cookie: cookieHeader },
  });
  expect(afterLogout.statusCode).toBe(401);
  await app.close();
});

test("returns the same generic response for invalid login credentials", async () => {
  const app = await authenticatedApp();
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: "missing@example.test", password: "wrong" },
  });
  expect(response.statusCode).toBe(401);
  expect(response.json()).toEqual({ error: "invalid credentials" });
  await app.close();
});

test("browser logout helper completes a CSRF-bound Fastify logout without a JSON body", async () => {
  const app = await authenticatedApp();
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: {
      email: "owner@example.test",
      password: "correct horse battery staple",
    },
  });
  const session = login.cookies.find((cookie) => cookie.name === "pos_session");
  const csrf = login.cookies.find((cookie) => cookie.name === "pos_csrf");
  const cookieHeader = `pos_session=${session?.value}; pos_csrf=${csrf?.value}`;
  let receivedHeaders: HeadersInit | undefined;
  const apiFetch: typeof fetch = async (_input, init) => {
    receivedHeaders = init?.headers;
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: {
        cookie: cookieHeader,
        ...Object.fromEntries(new Headers(init?.headers).entries()),
      },
    });
    return new Response(response.statusCode === 204 ? null : response.body, {
      status: response.statusCode,
    });
  };

  try {
    await expect(
      logoutRequest(apiFetch, csrf?.value ?? ""),
    ).resolves.toBeUndefined();
    expect(new Headers(receivedHeaders).get("content-type")).toBeNull();
    const afterLogout = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: cookieHeader },
    });
    expect(afterLogout.statusCode).toBe(401);
  } finally {
    await app.close();
  }
});
