import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { asNativeId, type NativeId } from "../../domain/src/ids.ts";
import type {
  CreatePageAssetLinkMutation,
  ArchivePageAssetLinkMutation,
  PageAssetLink,
} from "../../domain/src/page-asset-link.ts";
import {
  PageAssetLinkConflictError,
  type PageAssetLinkRepository,
} from "./page-asset-link-repository.ts";
import { auditEvents, pageAssetLinks, revisions } from "./schema.ts";
import type * as schema from "./schema.ts";

type Database = NodePgDatabase<typeof schema>;

export class PostgresPageAssetLinkRepository implements PageAssetLinkRepository {
  constructor(private readonly database: Database) {}
  async create(mutation: CreatePageAssetLinkMutation): Promise<PageAssetLink> {
    try {
      return await this.database.transaction(async (transaction) => {
        await transaction.insert(pageAssetLinks).values({
          ...mutation.link,
          provenance: { ...mutation.link.provenance },
          createdAt: new Date(mutation.link.createdAt),
          archivedAt: null,
        });
        await transaction.insert(revisions).values({
          id: mutation.revision.id,
          entityType: mutation.revision.entityType,
          entityId: mutation.revision.entityId,
          revisionNumber: 1,
          snapshot: { ...mutation.link },
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
          before: null,
          after: { ...mutation.link },
        });
        return mutation.link;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new PageAssetLinkConflictError();
      throw error;
    }
  }
  async archive(
    mutation: ArchivePageAssetLinkMutation,
  ): Promise<PageAssetLink> {
    return this.database.transaction(async (transaction) => {
      const updated = await transaction
        .update(pageAssetLinks)
        .set({ archivedAt: new Date(mutation.link.archivedAt!) })
        .where(
          and(
            eq(pageAssetLinks.id, mutation.link.id),
            isNull(pageAssetLinks.archivedAt),
          ),
        )
        .returning({ id: pageAssetLinks.id });
      if (updated.length !== 1) throw new PageAssetLinkConflictError();
      await transaction.insert(revisions).values({
        id: mutation.revision.id,
        entityType: mutation.revision.entityType,
        entityId: mutation.revision.entityId,
        revisionNumber: mutation.revision.revisionNumber,
        snapshot: { ...mutation.link },
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
        before: { ...mutation.audit.before! },
        after: { ...mutation.link },
      });
      return mutation.link;
    });
  }
  async getActive(pageId: NativeId, assetId: NativeId) {
    const rows = await this.database
      .select({
        link: pageAssetLinks,
        revisionNumber: revisions.revisionNumber,
        snapshot: revisions.snapshot,
      })
      .from(pageAssetLinks)
      .leftJoin(
        revisions,
        and(
          eq(revisions.entityType, "page-asset-link"),
          eq(revisions.entityId, pageAssetLinks.id),
        ),
      )
      .where(
        and(
          eq(pageAssetLinks.pageId, pageId),
          eq(pageAssetLinks.assetId, assetId),
          isNull(pageAssetLinks.archivedAt),
        ),
      )
      .orderBy(desc(revisions.revisionNumber))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const link = fromRow(row.link);
    if (
      row.revisionNumber === null ||
      !Number.isSafeInteger(row.revisionNumber) ||
      row.revisionNumber < 1 ||
      !linkSnapshotMatches(row.snapshot, link)
    )
      throw new Error("page asset link revision history is invalid");
    return {
      link,
      revisionNumber: row.revisionNumber,
    };
  }
  async listForPage(
    pageId: NativeId,
    scope: "active" | "all" = "active",
  ): Promise<readonly PageAssetLink[]> {
    const rows = await this.database
      .select()
      .from(pageAssetLinks)
      .where(
        scope === "active"
          ? and(
              eq(pageAssetLinks.pageId, pageId),
              isNull(pageAssetLinks.archivedAt),
            )
          : eq(pageAssetLinks.pageId, pageId),
      )
      .orderBy(asc(pageAssetLinks.createdAt), asc(pageAssetLinks.id));
    return rows.map(fromRow);
  }
}

function linkSnapshotMatches(snapshot: unknown, link: PageAssetLink): boolean {
  if (typeof snapshot !== "object" || snapshot === null) return false;
  const candidate = snapshot as Record<string, unknown>;
  return (
    candidate.id === link.id &&
    candidate.pageId === link.pageId &&
    candidate.assetId === link.assetId &&
    candidate.createdAt === link.createdAt &&
    candidate.archivedAt === link.archivedAt &&
    typeof candidate.provenance === "object" &&
    candidate.provenance !== null &&
    (candidate.provenance as Record<string, unknown>).source ===
      link.provenance.source &&
    (candidate.provenance as Record<string, unknown>).actorId ===
      link.provenance.actorId
  );
}

function fromRow(row: typeof pageAssetLinks.$inferSelect): PageAssetLink {
  if (
    typeof row.provenance.source !== "string" ||
    typeof row.provenance.actorId !== "string"
  )
    throw new Error("page asset link provenance is invalid");
  return Object.freeze({
    id: asNativeId(row.id),
    pageId: asNativeId(row.pageId),
    assetId: asNativeId(row.assetId),
    createdAt: row.createdAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    provenance: Object.freeze({
      source: row.provenance.source,
      actorId: row.provenance.actorId,
    }),
  });
}

function isUniqueViolation(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === "page_asset_links_live_unique"
  )
    return true;
  return (
    typeof error === "object" &&
    error !== null &&
    "cause" in error &&
    isUniqueViolation(error.cause)
  );
}
