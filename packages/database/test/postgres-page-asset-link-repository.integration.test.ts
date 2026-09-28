import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { expect, test } from "vitest";

import {
  archivePageAssetLink,
  createPageAssetLink,
} from "../../domain/src/page-asset-link.ts";
import { asNativeId } from "../../domain/src/ids.ts";
import { PostgresPageAssetLinkRepository } from "../src/postgres-page-asset-link-repository.ts";
import { PageAssetLinkConflictError } from "../src/page-asset-link-repository.ts";
import * as schema from "../src/schema.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;

test.skipIf(!databaseUrl)(
  "persists page asset links with atomic revision and audit evidence",
  async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const database = drizzle(pool, { schema });
    try {
      await migrate(database, {
        migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
      });
      const pageId = randomUUID();
      const assetId = randomUUID();
      await database.insert(schema.pages).values({
        id: pageId,
        title: "Linked page",
        createdAt: new Date(),
        updatedAt: new Date(),
        provenance: { source: "test", actorId: "owner" },
      });
      await database.insert(schema.assets).values({
        id: assetId,
        originalFilename: "proof.txt",
        mimeType: "text/plain",
        byteSize: 5,
        sha256: "a".repeat(64),
        storageKey: `asset-${assetId}`,
        createdAt: new Date(),
        provenance: { source: "test", actorId: "owner" },
      });
      const repository = new PostgresPageAssetLinkRepository(database);
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      const mutation = createPageAssetLink(
        {
          pageId: asNativeId(pageId),
          assetId: asNativeId(assetId),
          actorType: "user",
          actorId: "owner",
          source: "test",
        },
        {
          newId: () => ids.shift()!,
          now: () => new Date("2026-09-28T12:00:00Z"),
        },
      );
      await repository.create(mutation);
      expect(await repository.listForPage(asNativeId(pageId))).toEqual([
        mutation.link,
      ]);
      expect(
        await database
          .select()
          .from(schema.revisions)
          .where(
            and(
              eq(schema.revisions.entityType, "page-asset-link"),
              eq(schema.revisions.entityId, mutation.link.id),
            ),
          ),
      ).toHaveLength(1);
      expect(
        await database
          .select()
          .from(schema.auditEvents)
          .where(
            and(
              eq(schema.auditEvents.action, "page.asset-linked"),
              eq(schema.auditEvents.targetId, mutation.link.id),
            ),
          ),
      ).toHaveLength(1);
      const duplicate = createPageAssetLink(
        {
          pageId: asNativeId(pageId),
          assetId: asNativeId(assetId),
          actorType: "user",
          actorId: "owner",
          source: "test",
        },
        { newId: randomUUID, now: () => new Date() },
      );
      await expect(repository.create(duplicate)).rejects.toBeInstanceOf(
        PageAssetLinkConflictError,
      );
      const archived = archivePageAssetLink(
        mutation.link,
        1,
        { actorType: "user", actorId: "owner", source: "test" },
        {
          newId: () => randomUUID(),
          now: () => new Date("2026-09-28T13:00:00Z"),
        },
      );
      await repository.archive(archived);
      expect(await repository.listForPage(asNativeId(pageId))).toEqual([]);
      expect(await repository.listForPage(asNativeId(pageId), "all")).toEqual([
        archived.link,
      ]);
      expect(
        await repository.getActive(asNativeId(pageId), asNativeId(assetId)),
      ).toBeNull();
      expect(
        await database
          .select()
          .from(schema.revisions)
          .where(
            and(
              eq(schema.revisions.entityType, "page-asset-link"),
              eq(schema.revisions.entityId, mutation.link.id),
            ),
          ),
      ).toHaveLength(2);
      expect(
        await database
          .select()
          .from(schema.auditEvents)
          .where(
            and(
              eq(schema.auditEvents.action, "page.asset-unlinked"),
              eq(schema.auditEvents.targetId, mutation.link.id),
            ),
          ),
      ).toHaveLength(1);
      const relink = createPageAssetLink(
        {
          pageId: asNativeId(pageId),
          assetId: asNativeId(assetId),
          actorType: "user",
          actorId: "owner",
          source: "test",
        },
        {
          newId: () => randomUUID(),
          now: () => new Date("2026-09-28T14:00:00Z"),
        },
      );
      await repository.create(relink);
      expect(
        (await repository.getActive(asNativeId(pageId), asNativeId(assetId)))
          ?.link.id,
      ).toBe(relink.link.id);
      await database
        .update(schema.revisions)
        .set({ revisionNumber: 0 })
        .where(
          and(
            eq(schema.revisions.entityType, "page-asset-link"),
            eq(schema.revisions.entityId, relink.link.id),
          ),
        );
      await expect(
        repository.getActive(asNativeId(pageId), asNativeId(assetId)),
      ).rejects.toThrow("page asset link revision history is invalid");
      await database
        .delete(schema.revisions)
        .where(
          and(
            eq(schema.revisions.entityType, "page-asset-link"),
            eq(schema.revisions.entityId, relink.link.id),
          ),
        );
      await expect(
        repository.getActive(asNativeId(pageId), asNativeId(assetId)),
      ).rejects.toThrow("page asset link revision history is invalid");
    } finally {
      await pool.end();
    }
  },
);
