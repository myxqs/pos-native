import type { AuditEvent, Revision } from "../../domain/src/audit.ts";
import {
  BlockDocumentRevisionConflictError,
  normaliseBlockDocument,
  type Block,
  type BlockDocument,
  type ReplaceBlockDocumentMutation,
} from "../../domain/src/block-document.ts";
import type { NativeId } from "../../domain/src/ids.ts";

export { BlockDocumentRevisionConflictError } from "../../domain/src/block-document.ts";

export class BlockDocumentIdentityConflictError extends Error {
  constructor() {
    super("block identity has already been used");
    this.name = "BlockDocumentIdentityConflictError";
  }
}

export class BlockDocumentPageArchivedError extends Error {
  constructor() {
    super("page is archived");
    this.name = "BlockDocumentPageArchivedError";
  }
}

export interface PersistedBlockDocument {
  readonly document: BlockDocument;
  readonly revisionNumber: number;
}

export interface BlockDocumentRepository {
  getByPageId(pageId: NativeId): Promise<PersistedBlockDocument | null>;
  replace(mutation: ReplaceBlockDocumentMutation): Promise<BlockDocument>;
}

type FailurePoint = "before-blocks" | "before-revision" | "before-audit";

interface PageDocumentState {
  readonly revisionNumber: number;
  readonly modifiedAt: string;
}

export class InMemoryBlockDocumentRepository implements BlockDocumentRepository {
  readonly #pages = new Map<NativeId, PageDocumentState>();
  readonly #blocks = new Map<NativeId, Block>();
  readonly #revisions: Revision<BlockDocument, "block-document">[] = [];
  readonly #audits: AuditEvent<
    BlockDocument,
    "block-document",
    "block-document.updated"
  >[] = [];
  readonly #failAt: FailurePoint | undefined;
  readonly #isPageLive: (pageId: NativeId) => boolean;

  constructor(
    options: {
      failAt?: FailurePoint;
      isPageLive?: (pageId: NativeId) => boolean;
    } = {},
  ) {
    this.#failAt = options.failAt;
    this.#isPageLive = options.isPageLive ?? (() => true);
  }

  registerPage(
    pageId: NativeId,
    modifiedAt = "1970-01-01T00:00:00.000Z",
  ): void {
    if (this.#pages.has(pageId)) {
      throw new Error("page is already registered");
    }
    this.#pages.set(pageId, {
      revisionNumber: 0,
      modifiedAt: canonicalTimestamp(modifiedAt),
    });
  }

  async getByPageId(pageId: NativeId): Promise<PersistedBlockDocument | null> {
    const state = this.#pages.get(pageId);
    if (!state) return null;
    return {
      document: this.#currentDocument(pageId, state.revisionNumber),
      revisionNumber: state.revisionNumber,
    };
  }

  async replace(
    mutation: ReplaceBlockDocumentMutation,
  ): Promise<BlockDocument> {
    const candidateDocument = normaliseBlockDocument(mutation.document);
    const currentState = this.#pages.get(candidateDocument.pageId);
    if (!currentState) {
      throw new Error("page does not exist");
    }
    if (!this.#isPageLive(candidateDocument.pageId)) {
      throw new BlockDocumentPageArchivedError();
    }
    if (candidateDocument.revisionNumber !== currentState.revisionNumber + 1) {
      throw new BlockDocumentRevisionConflictError();
    }
    const currentDocument = this.#currentDocument(
      candidateDocument.pageId,
      currentState.revisionNumber,
    );
    const document = validateBlockDocumentMutation(mutation, currentDocument);
    if (document.revisionNumber !== currentState.revisionNumber + 1) {
      throw new BlockDocumentRevisionConflictError();
    }
    const currentBlockIds = new Set(
      currentDocument.blocks.map((currentBlock) => currentBlock.id),
    );
    for (const block of document.blocks) {
      if (!currentBlockIds.has(block.id) && this.#blocks.has(block.id)) {
        throw new BlockDocumentIdentityConflictError();
      }
    }

    const previousState = currentState;
    const previousBlocks = new Map(this.#blocks);
    const revisionLength = this.#revisions.length;
    const auditLength = this.#audits.length;
    try {
      this.#pages.set(document.pageId, {
        revisionNumber: document.revisionNumber,
        modifiedAt: mutation.audit.timestamp,
      });
      this.#injectFailure("before-blocks");
      for (const archiveId of mutation.archiveIds) {
        const currentBlock = this.#blocks.get(archiveId);
        if (
          !currentBlock ||
          currentBlock.pageId !== document.pageId ||
          currentBlock.archivedAt !== null
        ) {
          throw new Error("block archive target is invalid");
        }
        this.#blocks.set(
          archiveId,
          Object.freeze({
            ...currentBlock,
            updatedAt: mutation.audit.timestamp,
            archivedAt: mutation.audit.timestamp,
          }),
        );
      }
      for (const upsert of mutation.upserts) {
        this.#blocks.set(upsert.id, upsert);
      }
      this.#injectFailure("before-revision");
      this.#revisions.push(mutation.revision);
      this.#injectFailure("before-audit");
      this.#audits.push(mutation.audit);
      return document;
    } catch (error) {
      this.#pages.set(document.pageId, previousState);
      this.#blocks.clear();
      for (const [id, block] of previousBlocks) this.#blocks.set(id, block);
      this.#revisions.length = revisionLength;
      this.#audits.length = auditLength;
      throw error;
    }
  }

  pageStateFor(pageId: NativeId): PageDocumentState | null {
    return this.#pages.get(pageId) ?? null;
  }

  allBlocksFor(pageId: NativeId): readonly Block[] {
    return this.#blocksFor(pageId);
  }

  archivedBlocksFor(pageId: NativeId): readonly Block[] {
    return this.#blocksFor(pageId).filter(
      (currentBlock) => currentBlock.archivedAt !== null,
    );
  }

  revisionsFor(
    pageId: NativeId,
  ): readonly Revision<BlockDocument, "block-document">[] {
    return this.#revisions.filter((revision) => revision.entityId === pageId);
  }

  auditFor(
    pageId: NativeId,
  ): readonly AuditEvent<
    BlockDocument,
    "block-document",
    "block-document.updated"
  >[] {
    return this.#audits.filter((audit) => audit.targetId === pageId);
  }

  #currentDocument(pageId: NativeId, revisionNumber: number): BlockDocument {
    return normaliseBlockDocument({
      pageId,
      revisionNumber,
      blocks: this.#blocksFor(pageId).filter(
        (currentBlock) => currentBlock.archivedAt === null,
      ),
    });
  }

  #blocksFor(pageId: NativeId): readonly Block[] {
    return [...this.#blocks.values()]
      .filter((currentBlock) => currentBlock.pageId === pageId)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  #injectFailure(point: FailurePoint): void {
    if (this.#failAt === point) {
      throw new Error("injected failure " + point.replace("-", " "));
    }
  }
}

export function validateBlockDocumentMutation(
  mutation: ReplaceBlockDocumentMutation,
  currentDocument: BlockDocument,
): BlockDocument {
  const document = normaliseBlockDocument(mutation.document);
  if (
    document.pageId !== currentDocument.pageId ||
    document.revisionNumber !== currentDocument.revisionNumber + 1 ||
    mutation.revision.entityType !== "block-document" ||
    mutation.revision.entityId !== document.pageId ||
    mutation.revision.revisionNumber !== document.revisionNumber ||
    mutation.audit.targetType !== "block-document" ||
    mutation.audit.targetId !== document.pageId ||
    mutation.audit.action !== "block-document.updated"
  ) {
    throw new Error("block document mutation is inconsistent");
  }
  if (
    canonicalTimestamp(mutation.revision.createdAt) !==
      mutation.revision.createdAt ||
    canonicalTimestamp(mutation.audit.timestamp) !== mutation.audit.timestamp
  ) {
    throw new Error("block document mutation timestamp is invalid");
  }

  const revisionSnapshot = normaliseBlockDocument(mutation.revision.snapshot);
  const auditBefore = mutation.audit.before
    ? normaliseBlockDocument(mutation.audit.before)
    : null;
  const auditAfter = normaliseBlockDocument(mutation.audit.after);
  if (
    !sameDocument(revisionSnapshot, document) ||
    !sameDocument(auditAfter, document) ||
    !auditBefore ||
    !sameDocument(auditBefore, currentDocument)
  ) {
    throw new Error("block document mutation history is inconsistent");
  }

  const expectedArchiveIds = currentDocument.blocks
    .filter(
      (currentBlock) =>
        !document.blocks.some((candidate) => candidate.id === currentBlock.id),
    )
    .map((currentBlock) => currentBlock.id);
  if (!sameIds(mutation.archiveIds, expectedArchiveIds)) {
    throw new Error("block document archive set is inconsistent");
  }

  const currentById = new Map(
    currentDocument.blocks.map((currentBlock) => [
      currentBlock.id,
      currentBlock,
    ]),
  );
  const expectedUpserts = document.blocks.filter((candidate) => {
    const currentBlock = currentById.get(candidate.id);
    return !currentBlock || !sameBlock(currentBlock, candidate);
  });
  if (
    mutation.upserts.length !== expectedUpserts.length ||
    mutation.upserts.some(
      (upsert, index) =>
        !expectedUpserts[index] || !sameBlock(upsert, expectedUpserts[index]),
    )
  ) {
    throw new Error("block document upserts are inconsistent");
  }

  return document;
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

function sameIds(
  left: readonly NativeId[],
  right: readonly NativeId[],
): boolean {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

function canonicalTimestamp(value: string): string {
  if (typeof value !== "string") {
    throw new Error("block document timestamp is invalid");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new Error("block document timestamp is invalid");
  }
  return value;
}
