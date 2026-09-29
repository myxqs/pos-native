import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { expect, test } from "vitest";

import { hashPassword } from "../../../packages/auth/src/password.ts";
import { InMemoryAuthenticationStore } from "../../../packages/auth/src/session.ts";
import { PostgresAssetMetadataRepository } from "../../../packages/database/src/postgres-asset-metadata-repository.ts";
import { PostgresBlockDocumentRepository } from "../../../packages/database/src/postgres-block-document-repository.ts";
import { PostgresPageRepository } from "../../../packages/database/src/postgres-page-repository.ts";
import * as schema from "../../../packages/database/src/schema.ts";
import { asNativeId } from "../../../packages/domain/src/ids.ts";
import { createProductionRuntime } from "../src/runtime.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;

test.skipIf(!databaseUrl)(
  "production runtime persists authenticated asset bytes, metadata, revision, and audit evidence",
  async () => {
    const assetRoot = await mkdtemp(join(tmpdir(), "nativepos-assets-"));
    const pool = new Pool({ connectionString: databaseUrl });
    const database = drizzle(pool, { schema });
    await migrate(database, {
      migrationsFolder: fileURLToPath(
        new URL("../../../packages/database/drizzle", import.meta.url),
      ),
    });
    const email = `asset-${randomUUID()}@example.test`;
    const password = "synthetic local asset password";
    const userId = randomUUID();
    const authenticationStore = new InMemoryAuthenticationStore([
      {
        id: userId,
        email,
        passwordHash: await hashPassword(password),
      },
    ]);
    const assetRepository = new PostgresAssetMetadataRepository(database);
    const runtime = await createProductionRuntime(
      {
        DATABASE_URL: databaseUrl,
        POS_WEB_ASSET_ROOT: fileURLToPath(
          new URL("../../web", import.meta.url),
        ),
        POS_ASSET_ROOT: assetRoot,
        POS_MAX_ASSET_BYTES: "1024",
        POS_SERVICE_TOKEN:
          "synthetic-production-asset-test-token-0123456789abcdef",
      },
      {
        createPersistence: () => ({
          authenticationStore,
          pageRepository: new PostgresPageRepository(database),
          blockDocumentRepository: new PostgresBlockDocumentRepository(
            database,
          ),
          assetMetadataRepository: assetRepository,
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
      const cookie = `pos_session=${session?.value}; pos_csrf=${csrf?.value}`;
      const bytes = Buffer.from("synthetic production asset proof");
      const upload = await runtime.app.inject({
        method: "POST",
        url: "/api/v1/assets",
        headers: {
          cookie,
          "x-pos-csrf": csrf?.value ?? "",
          "content-type": "application/octet-stream",
          "x-nativepos-filename": encodeURIComponent("proof.txt"),
          "x-nativepos-media-type": "text/plain",
        },
        payload: bytes,
      });
      expect(upload.statusCode).toBe(201);
      const assetId = upload.json().asset.id as string;

      const list = await runtime.app.inject({
        method: "GET",
        url: "/api/v1/assets?limit=50",
        headers: { cookie },
      });
      const download = await runtime.app.inject({
        method: "GET",
        url: `/api/v1/assets/${assetId}/content`,
        headers: { cookie },
      });
      const revisions = await database
        .select()
        .from(schema.revisions)
        .where(
          and(
            eq(schema.revisions.entityType, "asset"),
            eq(schema.revisions.entityId, assetId),
          ),
        );
      const audits = await database
        .select()
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.targetType, "asset"),
            eq(schema.auditEvents.targetId, assetId),
          ),
        );

      expect(list.statusCode).toBe(200);
      expect(list.json().assets).toContainEqual(upload.json().asset);
      expect(download.statusCode).toBe(200);
      expect(download.rawPayload).toEqual(bytes);
      expect(
        (await assetRepository.getById(asNativeId(assetId)))?.asset.id,
      ).toBe(assetId);
      expect(revisions).toHaveLength(1);
      expect(audits).toHaveLength(1);
      expect(audits[0]?.actorId).toBe(userId);
    } finally {
      await runtime.close();
      await rm(assetRoot, { recursive: true, force: true });
    }
  },
  15_000,
);
