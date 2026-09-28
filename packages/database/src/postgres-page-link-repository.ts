import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { asNativeId, type NativeId } from "../../domain/src/ids.ts";
import type {
  ArchivePageLinkMutation,
  CreatePageLinkMutation,
  PageLink,
} from "../../domain/src/page-link.ts";
import {
  PageLinkConflictError,
  type PageLinkItem,
  type PageLinkListOptions,
  type PageLinkRepository,
} from "./page-link-repository.ts";
import { auditEvents, pageLinks, pages, revisions } from "./schema.ts";
import type * as schema from "./schema.ts";
type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const HIERARCHY_ADVISORY_LOCK_KEY = 1_652_046_113;

export class PostgresPageLinkRepository implements PageLinkRepository {
  constructor(private readonly database: Database) {}
  async create(mutation: CreatePageLinkMutation): Promise<PageLink> {
    try {
      return await this.database.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${HIERARCHY_ADVISORY_LOCK_KEY})`,
        );
        await requireLive(tx, mutation.link.sourcePageId);
        await requireLive(tx, mutation.link.targetPageId);
        await tx.insert(pageLinks).values({
          ...mutation.link,
          createdAt: new Date(mutation.link.createdAt),
          archivedAt: null,
          provenance: { ...mutation.link.provenance },
        });
        await writeHistory(tx, mutation);
        return mutation.link;
      });
    } catch (error) {
      if (unique(error)) throw new PageLinkConflictError();
      throw error;
    }
  }
  async archive(mutation: ArchivePageLinkMutation): Promise<PageLink> {
    return this.database.transaction(async (tx) => {
      const current = await tx
        .select({
          revisionNumber: revisions.revisionNumber,
          snapshot: revisions.snapshot,
        })
        .from(pageLinks)
        .innerJoin(
          revisions,
          and(
            eq(revisions.entityType, "page-link"),
            eq(revisions.entityId, pageLinks.id),
          ),
        )
        .where(
          and(eq(pageLinks.id, mutation.link.id), isNull(pageLinks.archivedAt)),
        )
        .orderBy(desc(revisions.revisionNumber))
        .limit(1);
      const row = current[0];
      if (
        !row ||
        row.revisionNumber + 1 !== mutation.revision.revisionNumber ||
        !snapshot(row.snapshot, mutation.audit.before!)
      )
        throw new PageLinkConflictError("page link revision conflict");
      const updated = await tx
        .update(pageLinks)
        .set({ archivedAt: new Date(mutation.link.archivedAt!) })
        .where(
          and(eq(pageLinks.id, mutation.link.id), isNull(pageLinks.archivedAt)),
        )
        .returning({ id: pageLinks.id });
      if (updated.length !== 1)
        throw new PageLinkConflictError("page link revision conflict");
      await writeHistory(tx, mutation);
      return mutation.link;
    });
  }
  async getActive(sourcePageId: NativeId, targetPageId: NativeId) {
    const rows = await this.database
      .select({
        link: pageLinks,
        revisionNumber: revisions.revisionNumber,
        snapshot: revisions.snapshot,
      })
      .from(pageLinks)
      .innerJoin(
        revisions,
        and(
          eq(revisions.entityType, "page-link"),
          eq(revisions.entityId, pageLinks.id),
        ),
      )
      .where(
        and(
          eq(pageLinks.sourcePageId, sourcePageId),
          eq(pageLinks.targetPageId, targetPageId),
          isNull(pageLinks.archivedAt),
        ),
      )
      .orderBy(desc(revisions.revisionNumber))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const link = fromRow(row.link);
    if (row.revisionNumber < 1 || !snapshot(row.snapshot, link))
      throw new Error("page link revision history is invalid");
    return { link, revisionNumber: row.revisionNumber };
  }
  listForward(pageId: NativeId, options: PageLinkListOptions) {
    return this.#list(pageId, true, options);
  }
  listBacklinks(pageId: NativeId, options: PageLinkListOptions) {
    return this.#list(pageId, false, options);
  }
  async #list(
    pageId: NativeId,
    forward: boolean,
    options: PageLinkListOptions,
  ): Promise<readonly PageLinkItem[]> {
    if (
      !Number.isSafeInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > 100
    )
      throw new Error("page link limit is invalid");
    const rows = await this.database.execute<Record<string, unknown>>(
      forward
        ? sql`select l.*, l.target_page_id as page_id, p.title as page_title, rev.revision_number, rev.snapshot from page_links l join pages owner on owner.id=l.source_page_id join pages p on p.id=l.target_page_id join lateral (select r.revision_number,r.snapshot from revisions r where r.entity_type='page-link' and r.entity_id=l.id order by r.revision_number desc limit 1) rev on true where l.source_page_id=${pageId} ${options.scope === "active" ? sql`and l.archived_at is null and owner.archived_at is null and p.archived_at is null` : sql``} order by l.created_at,l.id limit ${options.limit}`
        : sql`select l.*, l.source_page_id as page_id, p.title as page_title, rev.revision_number, rev.snapshot from page_links l join pages owner on owner.id=l.target_page_id join pages p on p.id=l.source_page_id join lateral (select r.revision_number,r.snapshot from revisions r where r.entity_type='page-link' and r.entity_id=l.id order by r.revision_number desc limit 1) rev on true where l.target_page_id=${pageId} ${options.scope === "active" ? sql`and l.archived_at is null and owner.archived_at is null and p.archived_at is null` : sql``} order by l.created_at,l.id limit ${options.limit}`,
    );
    return rows.rows.map((row) => {
      const link = fromRaw(row);
      const revisionNumber = Number(row["revision_number"]);
      if (
        !Number.isSafeInteger(revisionNumber) ||
        revisionNumber < 1 ||
        !snapshot(row["snapshot"], link)
      )
        throw new Error("page link revision history is invalid");
      return {
        link,
        page: {
          id: asNativeId(String(row["page_id"])),
          title: String(row["page_title"]),
        },
      };
    });
  }
}
async function requireLive(tx: Transaction, id: NativeId) {
  const row = (
    await tx
      .select({ archivedAt: pages.archivedAt })
      .from(pages)
      .where(eq(pages.id, id))
      .limit(1)
  )[0];
  if (!row) throw new PageLinkConflictError("page link endpoint is missing");
  if (row.archivedAt)
    throw new PageLinkConflictError("page link endpoint is archived");
}
async function writeHistory(
  tx: Transaction,
  mutation: CreatePageLinkMutation | ArchivePageLinkMutation,
) {
  await tx.insert(revisions).values({
    id: mutation.revision.id,
    entityType: "page-link",
    entityId: mutation.link.id,
    revisionNumber: mutation.revision.revisionNumber,
    snapshot: { ...mutation.link },
    createdAt: new Date(mutation.revision.createdAt),
  });
  await tx.insert(auditEvents).values({
    id: mutation.audit.id,
    occurredAt: new Date(mutation.audit.timestamp),
    actorType: mutation.audit.actorType,
    actorId: mutation.audit.actorId,
    action: mutation.audit.action,
    targetType: "page-link",
    targetId: mutation.link.id,
    source: mutation.audit.source,
    before: mutation.audit.before ? { ...mutation.audit.before } : null,
    after: { ...mutation.link },
  });
}
function fromRow(row: typeof pageLinks.$inferSelect): PageLink {
  return Object.freeze({
    id: asNativeId(row.id),
    sourcePageId: asNativeId(row.sourcePageId),
    targetPageId: asNativeId(row.targetPageId),
    createdAt: row.createdAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    provenance: Object.freeze({
      source: String(row.provenance.source),
      actorId: String(row.provenance.actorId),
    }),
  });
}
function fromRaw(row: Record<string, unknown>): PageLink {
  const provenance = row["provenance"];
  if (!provenance || typeof provenance !== "object")
    throw new Error("page link provenance is invalid");
  const p = provenance as Record<string, unknown>;
  if (
    typeof p["source"] !== "string" ||
    p["source"].length === 0 ||
    typeof p["actorId"] !== "string" ||
    p["actorId"].length === 0
  )
    throw new Error("page link provenance is invalid");
  return Object.freeze({
    id: asNativeId(String(row["id"])),
    sourcePageId: asNativeId(String(row["source_page_id"])),
    targetPageId: asNativeId(String(row["target_page_id"])),
    createdAt: timestamp(row["created_at"]),
    archivedAt: row["archived_at"] ? timestamp(row["archived_at"]) : null,
    provenance: Object.freeze({
      source: String(p["source"]),
      actorId: String(p["actorId"]),
    }),
  });
}
function timestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime()))
    throw new Error("page link timestamp is invalid");
  return date.toISOString();
}
function snapshot(value: unknown, link: PageLink) {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const provenance = v["provenance"];
  if (!provenance || typeof provenance !== "object") return false;
  const p = provenance as Record<string, unknown>;
  return (
    v["id"] === link.id &&
    v["sourcePageId"] === link.sourcePageId &&
    v["targetPageId"] === link.targetPageId &&
    v["createdAt"] === link.createdAt &&
    v["archivedAt"] === link.archivedAt &&
    p["source"] === link.provenance.source &&
    p["actorId"] === link.provenance.actorId
  );
}
function unique(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (("constraint" in error && error.constraint === "page_links_live_unique") ||
      ("cause" in error && unique(error.cause)))
  );
}
