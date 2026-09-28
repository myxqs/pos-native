import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { expect, test } from "vitest";
import { asNativeId } from "../../domain/src/ids.ts";
import { archivePageLink, createPageLink } from "../../domain/src/page-link.ts";
import { PostgresPageLinkRepository } from "../src/postgres-page-link-repository.ts";
import { PageLinkConflictError } from "../src/page-link-repository.ts";
import * as schema from "../src/schema.ts";

const url = process.env.TEST_DATABASE_URL;
test.skipIf(!url)(
  "persists forward links, derives backlinks, archives, relinks, and survives repository restart",
  async () => {
    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool, { schema });
    try {
      await migrate(db, {
        migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
      });
      await pool.query(
        "truncate audit_events,revisions,page_links,pages cascade",
      );
      const source = randomUUID(),
        target = randomUUID();
      for (const { id, title } of [
        { id: source, title: "Source" },
        { id: target, title: "Target" },
      ])
        await db.insert(schema.pages).values({
          id,
          title,
          createdAt: new Date(),
          updatedAt: new Date(),
          provenance: { source: "test", actorId: "owner" },
        });
      const repository = new PostgresPageLinkRepository(db);
      const make = () =>
        createPageLink(
          {
            sourcePageId: asNativeId(source),
            targetPageId: asNativeId(target),
            actorType: "user",
            actorId: "owner",
            source: "test",
          },
          { newId: randomUUID, now: () => new Date("2026-09-28T12:00:00Z") },
        );
      const created = make();
      await repository.create(created);
      expect(
        await repository.listForward(asNativeId(source), {
          scope: "active",
          limit: 20,
        }),
      ).toMatchObject([
        {
          link: { id: created.link.id },
          page: { id: target, title: "Target" },
        },
      ]);
      expect(
        await repository.listBacklinks(asNativeId(target), {
          scope: "active",
          limit: 20,
        }),
      ).toMatchObject([{ page: { id: source, title: "Source" } }]);
      const duplicates = await Promise.allSettled([
        repository.create(make()),
        repository.create(make()),
      ]);
      expect(duplicates.every((result) => result.status === "rejected")).toBe(
        true,
      );
      expect(
        duplicates.every(
          (result) =>
            result.status === "rejected" &&
            result.reason instanceof PageLinkConflictError,
        ),
      ).toBe(true);
      const current = await repository.getActive(
        asNativeId(source),
        asNativeId(target),
      );
      const archived = archivePageLink(
        current!.link,
        current!.revisionNumber,
        { actorType: "user", actorId: "owner", source: "test" },
        { newId: randomUUID, now: () => new Date("2026-09-28T13:00:00Z") },
      );
      await repository.archive(archived);
      expect(
        await repository.listForward(asNativeId(source), {
          scope: "active",
          limit: 20,
        }),
      ).toEqual([]);
      expect(
        await repository.listBacklinks(asNativeId(target), {
          scope: "active",
          limit: 20,
        }),
      ).toEqual([]);
      expect(
        await repository.listForward(asNativeId(source), {
          scope: "all",
          limit: 20,
        }),
      ).toHaveLength(1);
      const relink = make();
      await repository.create(relink);
      const restarted = new PostgresPageLinkRepository(
        drizzle(pool, { schema }),
      );
      expect(
        (
          await restarted.listBacklinks(asNativeId(target), {
            scope: "active",
            limit: 20,
          })
        )[0]?.link.id,
      ).toBe(relink.link.id);
      await db
        .update(schema.pages)
        .set({ archivedAt: new Date() })
        .where((await import("drizzle-orm")).eq(schema.pages.id, target));
      expect(
        await restarted.listForward(asNativeId(source), {
          scope: "active",
          limit: 20,
        }),
      ).toEqual([]);
      const latestRevision = (
        await db
          .select({ id: schema.revisions.id })
          .from(schema.revisions)
          .where(
            and(
              eq(schema.revisions.entityType, "page-link"),
              eq(schema.revisions.entityId, relink.link.id),
            ),
          )
          .orderBy(desc(schema.revisions.revisionNumber))
          .limit(1)
      )[0];
      await db
        .update(schema.revisions)
        .set({ snapshot: { ...relink.link, targetPageId: randomUUID() } })
        .where(eq(schema.revisions.id, latestRevision!.id));
      await expect(
        restarted.listForward(asNativeId(source), {
          scope: "all",
          limit: 20,
        }),
      ).rejects.toThrow("page link revision history is invalid");
    } finally {
      await pool.end();
    }
  },
);
