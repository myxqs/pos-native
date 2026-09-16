import { asc, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { asNativeId, type NativeId } from "../../domain/src/ids.ts";
import type {
  CreatePageMutation,
  Page,
  UpdatePageMutation,
} from "../../domain/src/page.ts";
import type { PageRepository, PersistedPage } from "./page-repository.ts";
import { auditEvents, pages, revisions } from "./schema.ts";
import type * as schema from "./schema.ts";

type Database = NodePgDatabase<typeof schema>;

export class PostgresPageRepository implements PageRepository {
  constructor(private readonly database: Database) {}

  async create(mutation: CreatePageMutation): Promise<Page> {
    return this.database.transaction(async (transaction) => {
      await transaction.insert(pages).values(toPageRow(mutation.page));
      await transaction.insert(revisions).values({
        id: mutation.revision.id,
        entityType: mutation.revision.entityType,
        entityId: mutation.revision.entityId,
        revisionNumber: mutation.revision.revisionNumber,
        snapshot: toJsonObject(mutation.revision.snapshot),
        createdAt: new Date(mutation.revision.createdAt),
      });
      await transaction.insert(auditEvents).values({
        id: mutation.audit.id,
        occurredAt: new Date(mutation.audit.timestamp),
        actorType: mutation.audit.actorType,
        actorId: mutation.audit.actorId,
        action: mutation.audit.action,
        targetType: mutation.audit.targetType,
        targetId: mutation.audit.targetId,
        source: mutation.audit.source,
        before: mutation.audit.before
          ? toJsonObject(mutation.audit.before)
          : null,
        after: toJsonObject(mutation.audit.after),
      });
      return mutation.page;
    });
  }

  async update(mutation: UpdatePageMutation): Promise<Page> {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction
        .update(pages)
        .set({
          title: mutation.page.title,
          updatedAt: new Date(mutation.page.modifiedAt),
          provenance: mutation.page.provenance,
        })
        .where(eq(pages.id, mutation.page.id))
        .returning({ id: pages.id });
      if (rows.length !== 1) {
        throw new Error("page does not exist");
      }
      await transaction.insert(revisions).values({
        id: mutation.revision.id,
        entityType: mutation.revision.entityType,
        entityId: mutation.revision.entityId,
        revisionNumber: mutation.revision.revisionNumber,
        snapshot: toJsonObject(mutation.revision.snapshot),
        createdAt: new Date(mutation.revision.createdAt),
      });
      await transaction.insert(auditEvents).values({
        id: mutation.audit.id,
        occurredAt: new Date(mutation.audit.timestamp),
        actorType: mutation.audit.actorType,
        actorId: mutation.audit.actorId,
        action: mutation.audit.action,
        targetType: mutation.audit.targetType,
        targetId: mutation.audit.targetId,
        source: mutation.audit.source,
        before: mutation.audit.before
          ? toJsonObject(mutation.audit.before)
          : null,
        after: toJsonObject(mutation.audit.after),
      });
      return mutation.page;
    });
  }

  async getById(id: NativeId): Promise<PersistedPage | null> {
    const pageRows = await this.database
      .select()
      .from(pages)
      .where(eq(pages.id, id))
      .limit(1);
    const row = pageRows[0];
    if (!row) return null;

    const revisionRows = await this.database
      .select({ revisionNumber: revisions.revisionNumber })
      .from(revisions)
      .where(eq(revisions.entityId, id))
      .orderBy(desc(revisions.revisionNumber))
      .limit(1);
    const revision = revisionRows[0];
    if (!revision) {
      throw new Error("page has no revision history");
    }

    return { page: fromPageRow(row), revisionNumber: revision.revisionNumber };
  }

  async list(): Promise<readonly Page[]> {
    const rows = await this.database
      .select()
      .from(pages)
      .orderBy(asc(pages.createdAt), asc(pages.id));
    return rows.map(fromPageRow);
  }
}

function toPageRow(page: Page): typeof pages.$inferInsert {
  return {
    id: page.id,
    title: page.title,
    archivedAt: page.archivedAt ? new Date(page.archivedAt) : null,
    createdAt: new Date(page.createdAt),
    updatedAt: new Date(page.modifiedAt),
    provenance: page.provenance,
  };
}

function fromPageRow(row: typeof pages.$inferSelect): Page {
  const source = row.provenance.source;
  const actorId = row.provenance.actorId;
  if (!source || !actorId) {
    throw new Error("page provenance is incomplete");
  }
  return Object.freeze({
    id: asNativeId(row.id),
    title: row.title,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    modifiedAt: row.updatedAt.toISOString(),
    provenance: Object.freeze({ source, actorId }),
  });
}

function toJsonObject(value: object): Record<string, unknown> {
  return { ...value };
}
