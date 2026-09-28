import { asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { asNativeId, type NativeId } from "../../domain/src/ids.ts";
import type {
  CreatePageAssetLinkMutation,
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
  async listForPage(pageId: NativeId): Promise<readonly PageAssetLink[]> {
    const rows = await this.database
      .select()
      .from(pageAssetLinks)
      .where(eq(pageAssetLinks.pageId, pageId))
      .orderBy(asc(pageAssetLinks.createdAt), asc(pageAssetLinks.id));
    return rows.map((row) => {
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
        provenance: Object.freeze({
          source: row.provenance.source,
          actorId: row.provenance.actorId,
        }),
      });
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === "page_asset_links_page_asset_unique"
  )
    return true;
  return (
    typeof error === "object" &&
    error !== null &&
    "cause" in error &&
    isUniqueViolation(error.cause)
  );
}
