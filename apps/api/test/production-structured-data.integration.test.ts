import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { expect, test } from "vitest";

import { hashPassword } from "../../../packages/auth/src/password.ts";
import { InMemoryAuthenticationStore } from "../../../packages/auth/src/session.ts";
import { PostgresBlockDocumentRepository } from "../../../packages/database/src/postgres-block-document-repository.ts";
import { PostgresDataSourceRepository } from "../../../packages/database/src/postgres-data-source-repository.ts";
import { PostgresPageRepository } from "../../../packages/database/src/postgres-page-repository.ts";
import * as schema from "../../../packages/database/src/schema.ts";
import { createProductionRuntime } from "../src/runtime.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;

test.skipIf(!databaseUrl)(
  "production runtime serves the authenticated structured-data journey on PostgreSQL",
  async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const database = drizzle(pool, { schema });
    await migrate(database, {
      migrationsFolder: fileURLToPath(
        new URL("../../../packages/database/drizzle", import.meta.url),
      ),
    });
    const email = "runtime@example.test";
    const password = "synthetic local integration password";
    const authenticationStore = new InMemoryAuthenticationStore([
      {
        id: randomUUID(),
        email,
        passwordHash: await hashPassword(password),
      },
    ]);

    const runtime = await createProductionRuntime(
      {
        DATABASE_URL: databaseUrl,
        POS_WEB_ASSET_ROOT: fileURLToPath(
          new URL("../../web", import.meta.url),
        ),
        POS_ASSET_ROOT: "synthetic-unused-asset-root",
      },
      {
        createPersistence: () => ({
          authenticationStore,
          pageRepository: new PostgresPageRepository(database),
          blockDocumentRepository: new PostgresBlockDocumentRepository(
            database,
          ),
          dataSourceRepository: new PostgresDataSourceRepository(database),
          close: async () => pool.end(),
        }),
      },
    );
    try {
      const login = await runtime.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password },
      });
      const session = login.cookies.find(
        (cookie) => cookie.name === "pos_session",
      );
      const csrf = login.cookies.find((cookie) => cookie.name === "pos_csrf");
      const headers = {
        cookie: `pos_session=${session?.value}; pos_csrf=${csrf?.value}`,
        "x-pos-csrf": csrf?.value ?? "",
      };
      const source = await runtime.app.inject({
        method: "POST",
        url: "/api/v1/data-sources",
        headers,
        payload: { name: `Runtime ${randomUUID()}` },
      });
      const record = await runtime.app.inject({
        method: "POST",
        url: `/api/v1/data-sources/${source.json().source.id}/items`,
        headers,
        payload: { title: "Runtime record" },
      });

      expect(login.statusCode).toBe(200);
      expect(source.statusCode).toBe(201);
      expect(record.statusCode).toBe(201);
      expect(record.headers.etag).toBe('"1"');
    } finally {
      await runtime.close();
    }
  },
  15_000,
);
