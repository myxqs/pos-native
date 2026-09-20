import { randomBytes, randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { z } from "zod";

import {
  AuthenticationService,
  type AuthenticationStore,
} from "../../../packages/auth/src/session.ts";
import { PostgresPageRepository } from "../../../packages/database/src/postgres-page-repository.ts";
import { createPostgresAuthenticationStore } from "../../../packages/database/src/postgres-authentication-store.ts";
import type { PageRepository } from "../../../packages/database/src/page-repository.ts";
import * as schema from "../../../packages/database/src/schema.ts";
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
  POS_LISTEN_HOST: z.enum(["127.0.0.1", "::1", "0.0.0.0", "::"]).optional(),
  POS_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
});

export interface RuntimeConfiguration {
  readonly databaseUrl: string;
  readonly webAssetRoot: string;
  readonly host: "127.0.0.1" | "::1" | "0.0.0.0" | "::";
  readonly port: number;
}

export interface RuntimePersistence {
  readonly authenticationStore: AuthenticationStore;
  readonly pageRepository: PageRepository;
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
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

function secureToken(): string {
  return randomBytes(32).toString("base64url");
}
