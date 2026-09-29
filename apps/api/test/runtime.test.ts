import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

import { expect, test, vi } from "vitest";

import { hashPassword } from "../../../packages/auth/src/password.ts";
import type { AssetStore } from "../../../packages/assets/src/asset-storage.ts";
import { InMemoryAuthenticationStore } from "../../../packages/auth/src/session.ts";
import { InMemoryAssetMetadataRepository } from "../../../packages/database/src/asset-metadata-repository.ts";
import { InMemoryBlockDocumentRepository } from "../../../packages/database/src/block-document-repository.ts";
import { InMemoryDataSourceRepository } from "../../../packages/database/src/data-source-repository.ts";
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
    POS_ASSET_ROOT: "synthetic-asset-root",
    POS_WEB_ASSET_ROOT: webAssetRoot,
    POS_SERVICE_TOKEN:
      "runtime-service-token-abcdefghijklmnopqrstuvwxyz-0123456789",
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
  expect(() =>
    parseRuntimeConfiguration(runtimeEnvironment({ POS_ASSET_ROOT: "   " })),
  ).toThrow("NativePOS runtime configuration is invalid");
  expect(() =>
    parseRuntimeConfiguration(
      runtimeEnvironment({ POS_SERVICE_TOKEN: "short" }),
    ),
  ).toThrow("NativePOS runtime configuration is invalid");
  for (const value of ["0", "-1", "1.5", "9007199254740992", "nope"]) {
    expect(() =>
      parseRuntimeConfiguration(
        runtimeEnvironment({ POS_MAX_ASSET_BYTES: value }),
      ),
    ).toThrow("NativePOS runtime configuration is invalid");
  }
});

test("defaults the asset byte limit and accepts a positive safe override", () => {
  expect(parseRuntimeConfiguration(runtimeEnvironment())).toMatchObject({
    assetRoot: "synthetic-asset-root",
    maxAssetBytes: 50 * 1024 * 1024,
  });
  expect(
    parseRuntimeConfiguration(
      runtimeEnvironment({ POS_MAX_ASSET_BYTES: "4096" }),
    ),
  ).toMatchObject({ maxAssetBytes: 4096 });
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
    dataSourceRepository: new InMemoryDataSourceRepository(),
    assetMetadataRepository: new InMemoryAssetMetadataRepository(),
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
    createAssetStore: async () => inMemoryAssetStore(),
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
  const collection = await runtime.app.inject({
    method: "POST",
    url: "/api/v1/data-sources",
    headers: { cookie: cookieHeader, "x-pos-csrf": csrf?.value ?? "" },
    payload: { name: "Projects" },
  });

  expect(login.statusCode).toBe(200);
  expect(session?.secure).toBe(true);
  expect(created.statusCode).toBe(201);
  expect(collection.statusCode).toBe(201);
  const uploaded = await runtime.app.inject({
    method: "POST",
    url: "/api/v1/assets",
    headers: {
      cookie: cookieHeader,
      "x-pos-csrf": csrf?.value ?? "",
      "content-type": "application/octet-stream",
      "x-nativepos-filename": "runtime.txt",
      "x-nativepos-media-type": "text/plain",
    },
    payload: Buffer.from("proof"),
  });
  expect(uploaded.statusCode).toBe(201);
  expect(createPersistence).toHaveBeenCalledWith(
    expect.objectContaining({
      databaseUrl: "postgresql://pos_native:password@localhost:5432/pos_native",
    }),
  );
  await runtime.close();
  expect(persistence.close).toHaveBeenCalledOnce();
});
test("closes persistence when asset storage construction fails", async () => {
  const persistence: RuntimePersistence = {
    authenticationStore: new InMemoryAuthenticationStore([]),
    pageRepository: new InMemoryPageRepository(),
    blockDocumentRepository: new InMemoryBlockDocumentRepository(),
    assetMetadataRepository: new InMemoryAssetMetadataRepository(),
    close: vi.fn(async () => undefined),
  };

  await expect(
    createProductionRuntime(runtimeEnvironment(), {
      createPersistence: () => persistence,
      createAssetStore: async () => {
        throw new Error("asset root unavailable");
      },
    }),
  ).rejects.toThrow("asset root unavailable");
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
    assetMetadataRepository: new InMemoryAssetMetadataRepository(),
    close: vi.fn(async () => undefined),
  };
  try {
    await expect(
      startProductionRuntime(
        runtimeEnvironment({ POS_PORT: String(address.port) }),
        {
          createPersistence: () => persistence,
          createAssetStore: async () => inMemoryAssetStore(),
        },
      ),
    ).rejects.toThrow();
    expect(persistence.close).toHaveBeenCalledOnce();
  } finally {
    await new Promise<void>((resolve, reject) =>
      blocker.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
test("refuses startup when persistence is not migration-ready", async () => {
  const persistence: RuntimePersistence = {
    authenticationStore: new InMemoryAuthenticationStore([]),
    pageRepository: new InMemoryPageRepository(),
    blockDocumentRepository: new InMemoryBlockDocumentRepository(),
    readiness: {
      check: async () => ({ ready: false, schemaVersion: "incompatible" }),
    },
    close: vi.fn(async () => undefined),
  };
  await expect(
    startProductionRuntime(runtimeEnvironment(), {
      createPersistence: () => persistence,
      createAssetStore: async () => inMemoryAssetStore(),
    }),
  ).rejects.toThrow("NativePOS persistence is not ready");
  expect(persistence.close).toHaveBeenCalledOnce();
});
test("closes persistence when web application composition fails", async () => {
  const persistence: RuntimePersistence = {
    authenticationStore: new InMemoryAuthenticationStore([]),
    pageRepository: new InMemoryPageRepository(),
    blockDocumentRepository: new InMemoryBlockDocumentRepository(),
    assetMetadataRepository: new InMemoryAssetMetadataRepository(),
    close: vi.fn(async () => undefined),
  };

  await expect(
    createProductionRuntime(
      runtimeEnvironment({ POS_WEB_ASSET_ROOT: "missing-nativepos-web-root" }),
      {
        createPersistence: () => persistence,
        createAssetStore: async () => inMemoryAssetStore(),
      },
    ),
  ).rejects.toThrow("NativePOS web assets are unavailable");
  expect(persistence.close).toHaveBeenCalledOnce();
});

function inMemoryAssetStore(): AssetStore {
  const bytesByKey = new Map<string, Uint8Array>();
  return {
    async stage(input) {
      const storageKey = `asset-${input.id}` as Awaited<
        ReturnType<AssetStore["stage"]>
      >["storageKey"];
      const bytes = Uint8Array.from(input.bytes);
      bytesByKey.set(storageKey, bytes);
      return {
        id: input.id,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        storageKey,
        byteSize: bytes.byteLength,
        sha256:
          "c1cda26362828b69266512052b97cb3729e3b052e4ade47c0a1e3383defe73c7",
      };
    },
    async read(storageKey) {
      const bytes = bytesByKey.get(storageKey);
      if (!bytes) throw new Error("missing asset");
      return Uint8Array.from(bytes);
    },
    async verify() {
      return true;
    },
    async discard(storageKey) {
      bytesByKey.delete(storageKey);
    },
  };
}
