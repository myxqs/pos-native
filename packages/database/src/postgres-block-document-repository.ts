import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { AuditEvent, Revision } from "../../domain/src/audit.ts";
import {
  normaliseBlockDocument,
  type Block,
  type BlockDocument,
  type ReplaceBlockDocumentMutation,
} from "../../domain/src/block-document.ts";
import { asNativeId, type NativeId } from "../../domain/src/ids.ts";
import {
  BlockDocumentIdentityConflictError,
  BlockDocumentPageArchivedError,
  BlockDocumentRevisionConflictError,
  type BlockDocumentRepository,
  type PersistedBlockDocument,
  validateBlockDocumentMutation,
} from "./block-document-repository.ts";
import { auditEvents, blocks, pages, revisions } from "./schema.ts";
import type * as schema from "./schema.ts";

type Database = NodePgDatabase<typeof schema>;

export class PostgresBlockDocumentRepository implements BlockDocumentRepository {
  constructor(private readonly database: Database) {}

  async getByPageId(pageId: NativeId): Promise<PersistedBlockDocument | null> {
    const pageRows = await this.database
      .select({
        id: pages.id,
        revisionNumber: pages.currentBlockDocumentRevisionNumber,
      })
      .from(pages)
      .where(eq(pages.id, pageId))
      .limit(1);
    const page = pageRows[0];
    if (!page) return null;

    const blockRows = await this.database
      .select()
      .from(blocks)
      .where(and(eq(blocks.pageId, page.id), isNull(blocks.archivedAt)))
      .orderBy(asc(blocks.position), asc(blocks.id));
    const document = normaliseBlockDocument({
      pageId: asNativeId(page.id),
      revisionNumber: page.revisionNumber,
      blocks: blockRows.map(fromBlockRow),
    });
    await this.#verifyCurrentRevision(document);
    return {
      document,
      revisionNumber: document.revisionNumber,
    };
  }

  async replace(
    mutation: ReplaceBlockDocumentMutation,
  ): Promise<BlockDocument> {
    const candidateDocument = normaliseBlockDocument(mutation.document);
    return this.database.transaction(async (transaction) => {
      const pageRows = await transaction
        .select({
          id: pages.id,
          archivedAt: pages.archivedAt,
          revisionNumber: pages.currentBlockDocumentRevisionNumber,
        })
        .from(pages)
        .where(eq(pages.id, candidateDocument.pageId))
        .limit(1);
      const page = pageRows[0];
      if (!page) {
        throw new Error("page does not exist");
      }
      if (page.archivedAt !== null) {
        throw new BlockDocumentPageArchivedError();
      }
      if (candidateDocument.revisionNumber !== page.revisionNumber + 1) {
        throw new BlockDocumentRevisionConflictError();
      }
      const currentBlockRows = await transaction
        .select()
        .from(blocks)
        .where(and(eq(blocks.pageId, page.id), isNull(blocks.archivedAt)))
        .orderBy(asc(blocks.position), asc(blocks.id));
      const currentDocument = normaliseBlockDocument({
        pageId: asNativeId(page.id),
        revisionNumber: page.revisionNumber,
        blocks: currentBlockRows.map(fromBlockRow),
      });
      const document = validateBlockDocumentMutation(mutation, currentDocument);
      const currentBlockIds = new Set(
        currentDocument.blocks.map((currentBlock) => currentBlock.id),
      );
      const newBlockIds = document.blocks
        .filter((block) => !currentBlockIds.has(block.id))
        .map((block) => block.id);
      if (newBlockIds.length > 0) {
        const collidingBlockRows = await transaction
          .select({ id: blocks.id })
          .from(blocks)
          .where(inArray(blocks.id, newBlockIds));
        if (collidingBlockRows.length > 0) {
          throw new BlockDocumentIdentityConflictError();
        }
      }

      const updatedPages = await transaction
        .update(pages)
        .set({
          currentBlockDocumentRevisionNumber: document.revisionNumber,
          updatedAt: new Date(mutation.audit.timestamp),
        })
        .where(
          and(
            eq(pages.id, document.pageId),
            eq(
              pages.currentBlockDocumentRevisionNumber,
              document.revisionNumber - 1,
            ),
            isNull(pages.archivedAt),
          ),
        )
        .returning({ id: pages.id });
      if (updatedPages.length !== 1) {
        const currentPageRows = await transaction
          .select({ archivedAt: pages.archivedAt })
          .from(pages)
          .where(eq(pages.id, document.pageId))
          .limit(1);
        if (currentPageRows[0]?.archivedAt !== null) {
          throw new BlockDocumentPageArchivedError();
        }
        throw new BlockDocumentRevisionConflictError();
      }

      const archiveTimestamp = new Date(mutation.audit.timestamp);
      await transaction
        .update(blocks)
        .set({
          archivedAt: archiveTimestamp,
          updatedAt: archiveTimestamp,
        })
        .where(
          and(eq(blocks.pageId, document.pageId), isNull(blocks.archivedAt)),
        );
      for (const block of document.blocks) {
        if (currentBlockIds.has(block.id)) {
          const updatedBlocks = await transaction
            .update(blocks)
            .set({
              pageId: block.pageId,
              parentBlockId: block.parentBlockId,
              blockType: block.blockType,
              position: block.position,
              content: { text: block.content.text },
              archivedAt: null,
              createdAt: new Date(block.createdAt),
              updatedAt: new Date(block.updatedAt),
            })
            .where(
              and(eq(blocks.id, block.id), eq(blocks.pageId, document.pageId)),
            )
            .returning({ id: blocks.id });
          if (updatedBlocks.length !== 1) {
            throw new Error("current block identity is unavailable");
          }
        } else {
          await transaction.insert(blocks).values(toBlockRow(block));
        }
      }
      await transaction
        .insert(revisions)
        .values(toRevisionRow(mutation.revision));
      await transaction.insert(auditEvents).values(toAuditRow(mutation.audit));
      return document;
    });
  }

  async #verifyCurrentRevision(document: BlockDocument): Promise<void> {
    if (document.revisionNumber === 0) {
      const history = await this.database
        .select({ id: revisions.id })
        .from(revisions)
        .where(
          and(
            eq(revisions.entityType, "block-document"),
            eq(revisions.entityId, document.pageId),
          ),
        )
        .limit(1);
      if (history.length !== 0) {
        throw new Error("block document revision history is invalid");
      }
      return;
    }

    const revisionRows = await this.database
      .select({
        revisionNumber: revisions.revisionNumber,
        snapshot: revisions.snapshot,
      })
      .from(revisions)
      .where(
        and(
          eq(revisions.entityType, "block-document"),
          eq(revisions.entityId, document.pageId),
        ),
      )
      .orderBy(desc(revisions.revisionNumber))
      .limit(1);
    const revision = revisionRows[0];
    if (
      !revision ||
      revision.revisionNumber !== document.revisionNumber ||
      !sameDocument(normaliseBlockDocument(revision.snapshot), document)
    ) {
      throw new Error("block document revision history is invalid");
    }
  }
}

function toBlockRow(block: Block): typeof blocks.$inferInsert {
  return {
    id: block.id,
    pageId: block.pageId,
    parentBlockId: block.parentBlockId,
    blockType: block.blockType,
    position: block.position,
    content: { text: block.content.text },
    archivedAt: block.archivedAt ? new Date(block.archivedAt) : null,
    createdAt: new Date(block.createdAt),
    updatedAt: new Date(block.updatedAt),
  };
}

function fromBlockRow(row: typeof blocks.$inferSelect): Block {
  return {
    id: asNativeId(row.id),
    pageId: asNativeId(row.pageId),
    parentBlockId: row.parentBlockId ? asNativeId(row.parentBlockId) : null,
    blockType: row.blockType as "paragraph",
    position: row.position,
    content: row.content as { readonly text: string },
    createdAt: canonicalTimestamp(row.createdAt),
    updatedAt: canonicalTimestamp(row.updatedAt),
    archivedAt: row.archivedAt ? canonicalTimestamp(row.archivedAt) : null,
  };
}

function toRevisionRow(
  revision: Revision<BlockDocument, "block-document">,
): typeof revisions.$inferInsert {
  return {
    id: revision.id,
    entityType: revision.entityType,
    entityId: revision.entityId,
    revisionNumber: revision.revisionNumber,
    snapshot: toJsonObject(revision.snapshot),
    createdAt: new Date(revision.createdAt),
  };
}

function toAuditRow(
  audit: AuditEvent<BlockDocument, "block-document", "block-document.updated">,
): typeof auditEvents.$inferInsert {
  return {
    id: audit.id,
    occurredAt: new Date(audit.timestamp),
    actorType: audit.actorType,
    actorId: audit.actorId,
    action: audit.action,
    targetType: audit.targetType,
    targetId: audit.targetId,
    requestId: audit.requestId ?? null,
    idempotencyKey: audit.idempotencyKey ?? null,
    source: audit.source,
    reason: audit.reason ?? null,
    before: audit.before ? toJsonObject(audit.before) : null,
    after: toJsonObject(audit.after),
    metadata: audit.metadata ? toJsonObject(audit.metadata) : null,
  };
}

function sameDocument(left: BlockDocument, right: BlockDocument): boolean {
  return (
    left.pageId === right.pageId &&
    left.revisionNumber === right.revisionNumber &&
    left.blocks.length === right.blocks.length &&
    left.blocks.every(
      (currentBlock, index) =>
        right.blocks[index] !== undefined &&
        sameBlock(currentBlock, right.blocks[index]),
    )
  );
}

function sameBlock(left: Block, right: Block): boolean {
  return (
    left.id === right.id &&
    left.pageId === right.pageId &&
    left.parentBlockId === right.parentBlockId &&
    left.blockType === right.blockType &&
    left.position === right.position &&
    left.content.text === right.content.text &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.archivedAt === right.archivedAt
  );
}

function canonicalTimestamp(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("block document timestamp is invalid");
  }
  return value.toISOString();
}

function toJsonObject(value: object): Record<string, unknown> {
  return { ...value };
}
