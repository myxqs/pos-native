import { createHash } from "node:crypto";

import { expect, test } from "vitest";

import { hashPassword } from "../src/password.ts";
import {
  AuthenticationService,
  InMemoryAuthenticationStore,
} from "../src/session.ts";

async function fixture() {
  const store = new InMemoryAuthenticationStore([
    {
      id: "11111111-1111-4111-8111-111111111111",
      email: "owner@example.test",
      passwordHash: await hashPassword("correct horse battery staple"),
    },
  ]);
  const tokens = ["session-secret", "csrf-secret"];
  const service = new AuthenticationService(store, {
    now: () => new Date("2026-09-16T12:00:00.000Z"),
    randomToken: () => tokens.shift() ?? "",
    sessionId: () => "22222222-2222-4222-8222-222222222222",
  });
  return { store, service };
}

test("logs in with a generic credential boundary and stores only token hashes", async () => {
  const { store, service } = await fixture();

  const login = await service.login(
    " OWNER@example.test ",
    "correct horse battery staple",
  );

  expect(login).toMatchObject({
    sessionToken: "session-secret",
    csrfToken: "csrf-secret",
    userId: "11111111-1111-4111-8111-111111111111",
    expiresAt: "2026-09-23T12:00:00.000Z",
  });
  expect(store.sessions[0]).toMatchObject({
    tokenHash: createHash("sha256").update("session-secret").digest("hex"),
    csrfTokenHash: createHash("sha256").update("csrf-secret").digest("hex"),
  });
  expect(JSON.stringify(store.sessions)).not.toContain("session-secret");
  expect(JSON.stringify(store.sessions)).not.toContain("csrf-secret");
});

test("rejects unknown accounts and wrong passwords with the same error", async () => {
  const { service } = await fixture();
  await expect(service.login("missing@example.test", "wrong")).rejects.toThrow(
    "invalid credentials",
  );
  await expect(service.login("owner@example.test", "wrong")).rejects.toThrow(
    "invalid credentials",
  );
});

test("authenticates a live session, validates CSRF, and revokes it on logout", async () => {
  const { service } = await fixture();
  const login = await service.login(
    "owner@example.test",
    "correct horse battery staple",
  );

  await expect(service.authenticate(login.sessionToken)).resolves.toMatchObject(
    {
      userId: login.userId,
    },
  );
  await expect(
    service.requireCsrf(login.sessionToken, login.csrfToken),
  ).resolves.toBeUndefined();
  await expect(
    service.requireCsrf(login.sessionToken, "wrong-csrf"),
  ).rejects.toThrow("invalid CSRF token");
  await service.logout(login.sessionToken);
  await expect(service.authenticate(login.sessionToken)).rejects.toThrow(
    "invalid session",
  );
});
