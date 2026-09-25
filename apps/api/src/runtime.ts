import { randomBytes, randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { z } from "zod";

import { AssetService } from "../../../packages/assets/src/asset-service.ts";
import {
  DEFAULT_MAX_ASSET_BYTES,
  type AssetStore,
} from "../../../packages/assets/src/asset-storage.ts";
import { FilesystemAssetStore } from "../../../packages/assets/src/filesystem-asset-store.ts";
import {
  AuthenticationService,
  type AuthenticationStore,
} from "../../../packages/auth/src/session.ts";
import { PostgresBlockDocumentRepository } from "../../../packages/database/src/postgres-block-document-repository.ts";
import { PostgresAssetMetadataRepository } from "../../../packages/database/src/postgres-asset-metadata-repository.ts";
import { PostgresDataSourceRepository } from "../../../packages/database/src/postgres-data-source-repository.ts";
import { PostgresPageRepository } from "../../../packages/database/src/postgres-page-repository.ts";
import { createPostgresAuthenticationStore } from "../../../packages/database/src/postgres-authentication-store.ts";
import type { BlockDocumentRepository } from "../../../packages/database/src/block-document-repository.ts";
import type { PageRepository } from "../../../packages/database/src/page-repository.ts";
import type { DataSourceRepository } from "../../../packages/database/src/data-source-repository.ts";
import type { AssetMetadataRepository } from "../../../packages/database/src/asset-metadata-repository.ts";
import * as schema from "../../../packages/database/src/schema.ts";
import type { BlockDocumentDependencies } from "../../../packages/domain/src/block-document.ts";
import type { CreatePageDependencies } from "../../../packages/domain/src/page.ts";
import { buildApp } from "./app.ts";

const runtimeEnvironmentSchema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (value) => {
        const protocol = new URL(value).protocol;
        return protocol === "postgres:" || protocol === "postgresql:";
      },
      { message: "must be a PostgreSQL URL" },
    ),
  POS_WEB_ASSET_ROOT: z.string().trim().min(1),
  POS_ASSET_ROOT: z.string().trim().min(1),
  POS_MAX_ASSET_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .refine(Number.isSafeInteger)
    .optional(),
  POS_LISTEN_HOST: z.enum(["127.0.0.1", "::1", "0.0.0.0", "::"]).optional(),
  POS_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
});

export interface RuntimeConfiguration {
  readonly databaseUrl: string;
  readonly webAssetRoot: string;
  readonly assetRoot: string;
  readonly maxAssetBytes: number;
  readonly host: "127.0.0.1" | "::1" | "0.0.0.0" | "::";
  readonly port: number;
}

export interface RuntimePersistence {
  readonly authenticationStore: AuthenticationStore;
  readonly pageRepository: PageRepository;
  readonly blockDocumentRepository: BlockDocumentRepository;
  readonly dataSourceRepository?: DataSourceRepository;
  readonly assetMetadataRepository?: AssetMetadataRepository;
  close(): Promise<void>;
}

export interface RuntimeDependencies {
  readonly createPersistence?: (
    configuration: RuntimeConfiguration,
  ) => RuntimePersistence;
  readonly now?: () => Date;
  readonly randomToken?: () => string;
  readonly sessionId?: () => string;
  readonly newId?: () => string;
  readonly createAssetStore?: (
    configuration: RuntimeConfiguration,
  ) => Promise<AssetStore>;
}

export interface ProductionRuntime {
  readonly app: ReturnType<typeof buildApp>;
  readonly configuration: RuntimeConfiguration;
  close(): Promise<void>;
}

export function parseRuntimeConfiguration(
  environment: NodeJS.ProcessEnv,
): RuntimeConfiguration {
  const parsed = runtimeEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error("NativePOS runtime configuration is invalid");
  }

  return {
    databaseUrl: parsed.data.DATABASE_URL,
    webAssetRoot: parsed.data.POS_WEB_ASSET_ROOT,
    assetRoot: parsed.data.POS_ASSET_ROOT,
    maxAssetBytes: parsed.data.POS_MAX_ASSET_BYTES ?? DEFAULT_MAX_ASSET_BYTES,
    host: parsed.data.POS_LISTEN_HOST ?? "127.0.0.1",
    port: parsed.data.POS_PORT ?? 3000,
  };
}

export async function createProductionRuntime(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: RuntimeDependencies = {},
): Promise<ProductionRuntime> {
  const configuration = parseRuntimeConfiguration(environment);
  const persistence = (
    dependencies.createPersistence ?? createPostgresPersistence
  )(configuration);
  const now = dependencies.now ?? (() => new Date());
  const newId = dependencies.newId ?? randomUUID;

  try {
    const assetStore = persistence.assetMetadataRepository
      ? await (dependencies.createAssetStore ?? createFilesystemAssetStore)(
          configuration,
        )
      : undefined;
    const app = buildApp({
      authenticationService: new AuthenticationService(
        persistence.authenticationStore,
        {
          now,
          randomToken: dependencies.randomToken ?? secureToken,
          sessionId: dependencies.sessionId ?? randomUUID,
        },
      ),
      pageRepository: persistence.pageRepository,
      pageDependencies: { newId, now } satisfies CreatePageDependencies,
      blockDocumentRepository: persistence.blockDocumentRepository,
      blockDocumentDependencies: {
        newId,
        now,
      } satisfies BlockDocumentDependencies,
      ...(persistence.dataSourceRepository
        ? {
            dataSourceRepository: persistence.dataSourceRepository,
            dataSourceDependencies: { newId, now },
          }
        : {}),
      ...(persistence.assetMetadataRepository && assetStore
        ? {
            assetService: new AssetService({
              assetStore,
              assetRepository: persistence.assetMetadataRepository,
              newId,
              now,
            }),
            assetRepository: persistence.assetMetadataRepository,
            assetStore,
            assetRequestId: newId,
            maxAssetBytes: configuration.maxAssetBytes,
          }
        : {}),
      secureCookies: true,
      webAssetRoot: configuration.webAssetRoot,
    });

    return {
      app,
      configuration,
      async close(): Promise<void> {
        try {
          await app.close();
        } finally {
          await persistence.close();
        }
      },
    };
  } catch (error) {
    await persistence.close().catch(() => undefined);
    throw error;
  }
}

export async function startProductionRuntime(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: RuntimeDependencies = {},
): Promise<ProductionRuntime> {
  const runtime = await createProductionRuntime(environment, dependencies);
  try {
    await runtime.app.listen({
      host: runtime.configuration.host,
      port: runtime.configuration.port,
    });
    return runtime;
  } catch (error) {
    await runtime.close();
    throw error;
  }
}

function createPostgresPersistence(
  configuration: RuntimeConfiguration,
): RuntimePersistence {
  const pool = new Pool({ connectionString: configuration.databaseUrl });
  const database = drizzle(pool, { schema });

  return {
    authenticationStore: createPostgresAuthenticationStore(pool),
    pageRepository: new PostgresPageRepository(database),
    blockDocumentRepository: new PostgresBlockDocumentRepository(database),
    dataSourceRepository: new PostgresDataSourceRepository(database),
    assetMetadataRepository: new PostgresAssetMetadataRepository(database),
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

function createFilesystemAssetStore(
  configuration: RuntimeConfiguration,
): Promise<AssetStore> {
  return FilesystemAssetStore.create(configuration.assetRoot, {
    maxBytes: configuration.maxAssetBytes,
  });
}

function secureToken(): string {
  return randomBytes(32).toString("base64url");
}
