import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

import { expect, test, vi } from "vitest";

import { hashPassword } from "../../../packages/auth/src/password.ts";
import { InMemoryAuthenticationStore } from "../../../packages/auth/src/session.ts";
import { InMemoryBlockDocumentRepository } from "../../../packages/database/src/block-document-repository.ts";
import { InMemoryPageRepository } from "../../../packages/database/src/page-repository.ts";
import {
  createProductionRuntime,
  parseRuntimeConfiguration,
  startProductionRuntime,
  type RuntimePersistence,
} from "../src/runtime.ts";

const webAssetRoot = fileURLToPath(new URL("../../web/", import.meta.url));

function runtimeEnvironment(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: "postgresql://pos_native:password@localhost:5432/pos_native",
    POS_WEB_ASSET_ROOT: webAssetRoot,
    ...overrides,
  };
}

test("rejects missing or unsafe runtime configuration before composing services", () => {
  expect(() => parseRuntimeConfiguration({})).toThrow(
    "NativePOS runtime configuration is invalid",
  );
  expect(() =>
    parseRuntimeConfiguration(
      runtimeEnvironment({ DATABASE_URL: "https://database.example.test" }),
    ),
  ).toThrow("NativePOS runtime configuration is invalid");
});

test("defaults to loopback and accepts only explicit private deployment listeners", () => {
  expect(parseRuntimeConfiguration(runtimeEnvironment())).toMatchObject({
    host: "127.0.0.1",
    port: 3000,
  });
  expect(
    parseRuntimeConfiguration(
      runtimeEnvironment({ POS_LISTEN_HOST: "0.0.0.0", POS_PORT: "4312" }),
    ),
  ).toMatchObject({ host: "0.0.0.0", port: 4312 });
  expect(() =>
    parseRuntimeConfiguration(
      runtimeEnvironment({ POS_LISTEN_HOST: "example.test" }),
    ),
  ).toThrow("NativePOS runtime configuration is invalid");
});

test("composes persistent services into secure authenticated page routes", async () => {
  const password = "correct horse battery staple";
  const authenticationStore = new InMemoryAuthenticationStore([
    {
      id: "11111111-1111-4111-8111-111111111111",
      email: "owner@example.test",
      passwordHash: await hashPassword(password),
    },
  ]);
  const persistence: RuntimePersistence = {
    authenticationStore,
    pageRepository: new InMemoryPageRepository(),
    blockDocumentRepository: new InMemoryBlockDocumentRepository(),
    close: vi.fn(async () => undefined),
  };
  const createPersistence = vi.fn(() => persistence);
  const tokens = ["session-token", "csrf-token"];
  const runtime = await createProductionRuntime(runtimeEnvironment(), {
    createPersistence,
    now: () => new Date("2026-09-20T12:00:00.000Z"),
    randomToken: () => tokens.shift() ?? "",
    sessionId: () => "22222222-2222-4222-8222-222222222222",
    newId: () => "33333333-3333-4333-8333-333333333333",
  });

  const login = await runtime.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: "owner@example.test", password },
  });
  const session = login.cookies.find((cookie) => cookie.name === "pos_session");
  const csrf = login.cookies.find((cookie) => cookie.name === "pos_csrf");
  const cookieHeader = `pos_session=${session?.value}; pos_csrf=${csrf?.value}`;
  const created = await runtime.app.inject({
    method: "POST",
    url: "/api/v1/pages",
    headers: { cookie: cookieHeader, "x-pos-csrf": csrf?.value ?? "" },
    payload: { title: "Projects" },
  });

  expect(login.statusCode).toBe(200);
  expect(session?.secure).toBe(true);
  expect(created.statusCode).toBe(201);
  expect(createPersistence).toHaveBeenCalledWith(
    expect.objectContaining({
      databaseUrl: "postgresql://pos_native:password@localhost:5432/pos_native",
    }),
  );
  await runtime.close();
  expect(persistence.close).toHaveBeenCalledOnce();
});
test("closes persistence when the configured listener cannot start", async () => {
  const blocker = createServer();
  await new Promise<void>((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(0, "127.0.0.1", resolve);
  });
  const address = blocker.address();
  if (!address || typeof address === "string") {
    throw new Error("test listener did not expose a TCP port");
  }

  const persistence: RuntimePersistence = {
    authenticationStore: new InMemoryAuthenticationStore([]),
    pageRepository: new InMemoryPageRepository(),
    blockDocumentRepository: new InMemoryBlockDocumentRepository(),
    close: vi.fn(async () => undefined),
  };
  try {
    await expect(
      startProductionRuntime(
        runtimeEnvironment({ POS_PORT: String(address.port) }),
        { createPersistence: () => persistence },
      ),
    ).rejects.toThrow();
    expect(persistence.close).toHaveBeenCalledOnce();
  } finally {
    await new Promise<void>((resolve, reject) =>
      blocker.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
test("closes persistence when web application composition fails", async () => {
  const persistence: RuntimePersistence = {
    authenticationStore: new InMemoryAuthenticationStore([]),
    pageRepository: new InMemoryPageRepository(),
    blockDocumentRepository: new InMemoryBlockDocumentRepository(),
    close: vi.fn(async () => undefined),
  };

  await expect(
    createProductionRuntime(
      runtimeEnvironment({ POS_WEB_ASSET_ROOT: "missing-nativepos-web-root" }),
      { createPersistence: () => persistence },
    ),
  ).rejects.toThrow("NativePOS web assets are unavailable");
  expect(persistence.close).toHaveBeenCalledOnce();
});
