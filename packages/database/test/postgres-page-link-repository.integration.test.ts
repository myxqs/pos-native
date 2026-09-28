import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import { expect, test } from "vitest";
import { asNativeId } from "../../domain/src/ids.ts";
import { archivePageLink, createPageLink } from "../../domain/src/page-link.ts";
import { PostgresPageLinkRepository } from "../src/postgres-page-link-repository.ts";
import { PageLinkConflictError } from "../src/page-link-repository.ts";
import * as schema from "../src/schema.ts";

const url = process.env.TEST_DATABASE_URL;
const HIERARCHY_ADVISORY_LOCK_KEY = 1_652_046_113;

async function waitUntilBlocked(
  observer: PoolClient,
  blockedPid: number,
  blockerPid: number,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await observer.query<{ blocked: boolean }>(
      "select $1::int = any(pg_blocking_pids($2::int)) as blocked",
      [blockerPid, blockedPid],
    );
    if (result.rows[0]?.blocked) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("page link creation was not observed waiting for archive");
}

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

test.skipIf(!url).each(["source", "target"] as const)(
  "serializes page-link creation behind concurrent %s archive without residue",
  async (endpoint) => {
    const pool = new Pool({ connectionString: url });
    let archiveClient: PoolClient | undefined;
    let linkClient: PoolClient | undefined;
    let observer: PoolClient | undefined;
    let archiveOpen = false;
    let createPromise: Promise<unknown> | undefined;
    try {
      const db = drizzle(pool, { schema });
      await migrate(db, {
        migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
      });
      await pool.query(
        "truncate audit_events,revisions,page_links,pages cascade",
      );
      const source = randomUUID();
      const target = randomUUID();
      for (const [id, title] of [
        [source, "Source"],
        [target, "Target"],
      ])
        await pool.query(
          "insert into pages(id,title,created_at,updated_at,provenance) values($1,$2,now(),now(),$3::jsonb)",
          [id, title, JSON.stringify({ source: "test", actorId: "owner" })],
        );
      const mutation = createPageLink(
        {
          sourcePageId: asNativeId(source),
          targetPageId: asNativeId(target),
          actorType: "user",
          actorId: "owner",
          source: "test",
        },
        { newId: randomUUID, now: () => new Date("2026-09-28T14:00:00Z") },
      );
      archiveClient = await pool.connect();
      linkClient = await pool.connect();
      observer = await pool.connect();
      await archiveClient.query("begin");
      archiveOpen = true;
      const archivePid = (
        await archiveClient.query<{ pid: number }>(
          "select pg_backend_pid() pid",
        )
      ).rows[0]!.pid;
      await archiveClient.query("select pg_advisory_xact_lock($1)", [
        HIERARCHY_ADVISORY_LOCK_KEY,
      ]);
      await archiveClient.query(
        "update pages set archived_at=now() where id=$1",
        [endpoint === "source" ? source : target],
      );
      const linkPid = (
        await linkClient.query<{ pid: number }>("select pg_backend_pid() pid")
      ).rows[0]!.pid;
      const repository = new PostgresPageLinkRepository(
        drizzle(linkClient, { schema }),
      );
      createPromise = repository.create(mutation);
      await waitUntilBlocked(observer, linkPid, archivePid);
      await archiveClient.query("commit");
      archiveOpen = false;
      expect(
        (
          await observer.query<{ archived_at: Date | null }>(
            "select archived_at from pages where id=$1",
            [endpoint === "source" ? source : target],
          )
        ).rows[0]?.archived_at,
      ).toBeInstanceOf(Date);
      await expect(createPromise).rejects.toMatchObject({
        name: "PageLinkConflictError",
        message: "page link endpoint is archived",
      });
      const residue = await observer.query<{ count: string }>(
        `select count(*)::text count from (
          select id::text from page_links where id=$1 or (source_page_id=$2 and target_page_id=$3)
          union all select id::text from revisions where entity_type='page-link' and entity_id=$1
          union all select id::text from audit_events where target_type='page-link' and target_id=$1
        ) residue`,
        [mutation.link.id, source, target],
      );
      expect(residue.rows[0]?.count).toBe("0");
    } finally {
      if (archiveOpen && archiveClient) await archiveClient.query("rollback");
      if (createPromise) await createPromise.catch(() => undefined);
      archiveClient?.release();
      linkClient?.release();
      observer?.release();
      await pool.end();
    }
  },
);
