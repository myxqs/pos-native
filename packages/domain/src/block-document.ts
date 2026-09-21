import type { AuditActorType, AuditEvent, Revision } from "./audit.ts";
import { asNativeId, type NativeId, ValidationError } from "./ids.ts";

const MAX_BLOCKS_PER_DOCUMENT = 1_000;
const MAX_PARAGRAPH_TEXT_LENGTH = 20_000;
const MAX_DOCUMENT_TEXT_LENGTH = 250_000;
const MAX_NESTING_DEPTH = 32;
const CLIENT_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const AUDIT_ACTOR_TYPES: ReadonlySet<AuditActorType> = new Set([
  "user",
  "api-token",
  "importer",
  "system",
]);

export type BlockType = "paragraph";

export interface ParagraphContent {
  readonly text: string;
}

export interface Block {
  readonly id: NativeId;
  readonly pageId: NativeId;
  readonly parentBlockId: NativeId | null;
  readonly blockType: BlockType;
  readonly position: number;
  readonly content: ParagraphContent;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

export interface BlockDocument {
  readonly pageId: NativeId;
  readonly revisionNumber: number;
  readonly blocks: readonly Block[];
}

export interface BlockDraft {
  readonly clientRef: string;
  readonly id?: string;
  readonly parentClientRef?: string;
  readonly blockType: BlockType;
  readonly content: ParagraphContent;
}

export interface ReplaceBlockDocumentCommand {
  readonly pageId: string;
  readonly expectedRevisionNumber: number;
  readonly blocks: readonly unknown[];
  readonly actorType: AuditActorType;
  readonly actorId: string;
  readonly source: string;
  readonly requestId?: string;
  readonly reason?: string;
}

export interface BlockDocumentDependencies {
  readonly newId: () => string;
  readonly now: () => Date;
}

export interface ReplaceBlockDocumentMutation {
  readonly document: BlockDocument;
  readonly upserts: readonly Block[];
  readonly archiveIds: readonly NativeId[];
  readonly revision: Revision<BlockDocument, "block-document">;
  readonly audit: AuditEvent<
    BlockDocument,
    "block-document",
    "block-document.updated"
  >;
}

export type ReplaceBlockDocumentResult =
  | {
      readonly kind: "unchanged";
      readonly document: BlockDocument;
    }
  | {
      readonly kind: "changed";
      readonly mutation: ReplaceBlockDocumentMutation;
    };

export class BlockDocumentRevisionConflictError extends Error {
  constructor() {
    super("block document revision is stale");
    this.name = "BlockDocumentRevisionConflictError";
  }
}

interface ValidatedCommand {
  readonly pageId: NativeId;
  readonly expectedRevisionNumber: number;
  readonly blocks: readonly ParsedDraft[];
  readonly actorType: AuditActorType;
  readonly actorId: string;
  readonly source: string;
  readonly requestId?: NativeId;
  readonly reason?: string;
}

interface ParsedDraft {
  readonly clientRef: string;
  readonly id?: NativeId;
  readonly parentClientRef: string | null;
  readonly content: ParagraphContent;
}

interface CandidateBlock {
  readonly block: Block;
  readonly isChanged: boolean;
}

export function replaceBlockDocument(
  current: BlockDocument,
  command: ReplaceBlockDocumentCommand,
  dependencies: BlockDocumentDependencies,
): ReplaceBlockDocumentResult {
  const currentDocument = normaliseBlockDocument(current);
  const validatedCommand = validateCommand(command, currentDocument.pageId);

  if (
    validatedCommand.expectedRevisionNumber !== currentDocument.revisionNumber
  ) {
    throw new BlockDocumentRevisionConflictError();
  }

  validateDraftGraph(validatedCommand.blocks);
  const existingById = new Map(
    currentDocument.blocks.map((currentBlock) => [
      currentBlock.id,
      currentBlock,
    ]),
  );
  const draftIdsByRef = resolveDraftIds(
    validatedCommand.blocks,
    existingById,
    dependencies,
  );
  let mutationTimestamp: string | undefined;
  const timestampForMutation = (): string => {
    if (mutationTimestamp === undefined) {
      mutationTimestamp = canonicalTimestamp(dependencies.now());
    }
    return mutationTimestamp;
  };
  const candidates = buildCandidateBlocks(
    validatedCommand.blocks,
    draftIdsByRef,
    existingById,
    currentDocument.pageId,
    timestampForMutation,
  );
  const candidateBlocks = normaliseBlockOrder(
    candidates.map((candidate) => candidate.block),
  );
  const candidateById = new Map(
    candidates.map((candidate) => [candidate.block.id, candidate]),
  );
  const archiveIds = currentDocument.blocks
    .filter((currentBlock) => !candidateById.has(currentBlock.id))
    .map((currentBlock) => currentBlock.id);
  const upserts = candidateBlocks.filter(
    (candidate) => candidateById.get(candidate.id)?.isChanged,
  );

  if (archiveIds.length === 0 && upserts.length === 0) {
    return Object.freeze({
      kind: "unchanged" as const,
      document: currentDocument,
    });
  }

  const timestamp = timestampForMutation();
  const document = freezeDocument(
    currentDocument.pageId,
    currentDocument.revisionNumber + 1,
    candidateBlocks,
  );
  const revision = Object.freeze({
    id: asNativeId(dependencies.newId()),
    entityType: "block-document" as const,
    entityId: document.pageId,
    revisionNumber: document.revisionNumber,
    createdAt: timestamp,
    snapshot: document,
  });
  const audit = Object.freeze({
    id: asNativeId(dependencies.newId()),
    timestamp,
    actorType: validatedCommand.actorType,
    actorId: validatedCommand.actorId,
    action: "block-document.updated" as const,
    targetType: "block-document" as const,
    targetId: document.pageId,
    source: validatedCommand.source,
    ...(validatedCommand.requestId
      ? { requestId: validatedCommand.requestId }
      : {}),
    ...(validatedCommand.reason ? { reason: validatedCommand.reason } : {}),
    before: currentDocument,
    after: document,
  });

  return Object.freeze({
    kind: "changed" as const,
    mutation: Object.freeze({
      document,
      upserts: Object.freeze([...upserts]),
      archiveIds: Object.freeze([...archiveIds]),
      revision,
      audit,
    }),
  });
}

export function normaliseBlockDocument(value: unknown): BlockDocument {
  if (!isPlainRecord(value)) {
    throw new ValidationError("block document is invalid");
  }
  assertExactKeys(
    value,
    ["pageId", "revisionNumber", "blocks"],
    "block document",
  );
  const pageId = asNativeId(requireString(value, "pageId", "block document"));
  const revisionNumber = requireRevisionNumber(
    value.revisionNumber,
    "current document revision number",
  );
  if (!Array.isArray(value.blocks)) {
    throw new ValidationError("block document blocks are invalid");
  }
  if (value.blocks.length > MAX_BLOCKS_PER_DOCUMENT) {
    throw new ValidationError("block document exceeds the block limit");
  }
  const blocks = value.blocks.map((candidate) =>
    normaliseCurrentBlock(candidate, pageId),
  );
  validateLiveBlockTree(blocks);
  return freezeDocument(pageId, revisionNumber, normaliseBlockOrder(blocks));
}

function normaliseCurrentBlock(value: unknown, pageId: NativeId): Block {
  if (!isPlainRecord(value)) {
    throw new ValidationError("current block is invalid");
  }
  assertExactKeys(
    value,
    [
      "id",
      "pageId",
      "parentBlockId",
      "blockType",
      "position",
      "content",
      "createdAt",
      "updatedAt",
      "archivedAt",
    ],
    "current block",
  );
  const id = asNativeId(requireString(value, "id", "current block"));
  const blockPageId = asNativeId(
    requireString(value, "pageId", "current block"),
  );
  if (blockPageId !== pageId) {
    throw new ValidationError("current block belongs to another page");
  }
  const parentBlockId =
    value.parentBlockId === null
      ? null
      : asNativeId(requireString(value, "parentBlockId", "current block"));
  if (value.blockType !== "paragraph") {
    throw new ValidationError("current block type is unsupported");
  }
  const position = requireNonNegativeInteger(value.position, "block position");
  const content = validateParagraphContent(value.content);
  const createdAt = canonicalTimestamp(
    new Date(requireString(value, "createdAt", "current block")),
  );
  const updatedAt = canonicalTimestamp(
    new Date(requireString(value, "updatedAt", "current block")),
  );
  if (value.archivedAt !== null) {
    throw new ValidationError(
      "current document cannot contain archived blocks",
    );
  }

  return freezeBlock({
    id,
    pageId,
    parentBlockId,
    blockType: "paragraph",
    position,
    content,
    createdAt,
    updatedAt,
    archivedAt: null,
  });
}

function validateCommand(
  command: ReplaceBlockDocumentCommand,
  expectedPageId: NativeId,
): ValidatedCommand {
  if (!isPlainRecord(command)) {
    throw new ValidationError("block document command is invalid");
  }
  assertExactKeys(
    command,
    [
      "pageId",
      "expectedRevisionNumber",
      "blocks",
      "actorType",
      "actorId",
      "source",
      "requestId",
      "reason",
    ],
    "block document command",
  );
  const pageId = asNativeId(
    requireString(command, "pageId", "block document command"),
  );
  if (pageId !== expectedPageId) {
    throw new ValidationError("block document page does not match");
  }
  const expectedRevisionNumber = requireRevisionNumber(
    command.expectedRevisionNumber,
    "expected document revision number",
  );
  if (!Array.isArray(command.blocks)) {
    throw new ValidationError("block document blocks are invalid");
  }
  if (command.blocks.length > MAX_BLOCKS_PER_DOCUMENT) {
    throw new ValidationError("block document exceeds the block limit");
  }
  if (!AUDIT_ACTOR_TYPES.has(command.actorType)) {
    throw new ValidationError("actor type is not supported");
  }
  const actorId = validateBoundedText(command.actorId, "actor ID", 255);
  const source = validateBoundedText(command.source, "source", 128);
  const requestId =
    command.requestId === undefined
      ? undefined
      : asNativeId(validateBoundedText(command.requestId, "request ID", 36));
  const reason =
    command.reason === undefined
      ? undefined
      : validateBoundedText(command.reason, "reason", 500);
  const blocks = parseDrafts(command.blocks);

  return Object.freeze({
    pageId,
    expectedRevisionNumber,
    blocks: Object.freeze(blocks),
    actorType: command.actorType,
    actorId,
    source,
    ...(requestId ? { requestId } : {}),
    ...(reason ? { reason } : {}),
  });
}

function parseDrafts(values: readonly unknown[]): ParsedDraft[] {
  let totalTextLength = 0;
  const clientRefs = new Set<string>();
  const existingIds = new Set<NativeId>();

  return values.map((value) => {
    if (!isPlainRecord(value)) {
      throw new ValidationError("block draft is invalid");
    }
    assertExactKeys(
      value,
      ["clientRef", "id", "parentClientRef", "blockType", "content"],
      "block draft",
    );
    const clientRef = requireClientRef(
      requireString(value, "clientRef", "block draft"),
    );
    if (clientRefs.has(clientRef)) {
      throw new ValidationError("block draft client reference is duplicated");
    }
    clientRefs.add(clientRef);
    const id =
      value.id === undefined
        ? undefined
        : asNativeId(requireString(value, "id", "block draft"));
    if (id && existingIds.has(id)) {
      throw new ValidationError("block draft identity is duplicated");
    }
    if (id) existingIds.add(id);
    const parentClientRef =
      value.parentClientRef === undefined
        ? null
        : requireClientRef(
            requireString(value, "parentClientRef", "block draft"),
          );
    if (value.blockType !== "paragraph") {
      throw new ValidationError("block type is unsupported");
    }
    const content = validateParagraphContent(value.content);
    totalTextLength += content.text.length;
    if (totalTextLength > MAX_DOCUMENT_TEXT_LENGTH) {
      throw new ValidationError("block document text exceeds the limit");
    }

    return Object.freeze({
      clientRef,
      ...(id ? { id } : {}),
      parentClientRef,
      content,
    });
  });
}

function validateDraftGraph(drafts: readonly ParsedDraft[]): void {
  const byRef = new Map(drafts.map((draft) => [draft.clientRef, draft]));
  for (const draft of drafts) {
    if (draft.parentClientRef && !byRef.has(draft.parentClientRef)) {
      throw new ValidationError("block draft parent does not exist");
    }
    if (draft.parentClientRef === draft.clientRef) {
      throw new ValidationError("block draft cannot parent itself");
    }
  }

  const visiting = new Set<string>();
  const depths = new Map<string, number>();
  const depthFor = (clientRef: string): number => {
    const known = depths.get(clientRef);
    if (known !== undefined) return known;
    if (visiting.has(clientRef)) {
      throw new ValidationError("block draft parent graph contains a cycle");
    }
    visiting.add(clientRef);
    const draft = byRef.get(clientRef);
    if (!draft) {
      throw new ValidationError("block draft parent does not exist");
    }
    const depth = draft.parentClientRef
      ? depthFor(draft.parentClientRef) + 1
      : 1;
    visiting.delete(clientRef);
    if (depth > MAX_NESTING_DEPTH) {
      throw new ValidationError("block document exceeds the nesting limit");
    }
    depths.set(clientRef, depth);
    return depth;
  };

  for (const draft of drafts) depthFor(draft.clientRef);
}

function resolveDraftIds(
  drafts: readonly ParsedDraft[],
  existingById: ReadonlyMap<NativeId, Block>,
  dependencies: BlockDocumentDependencies,
): ReadonlyMap<string, NativeId> {
  const result = new Map<string, NativeId>();
  const assignedIds = new Set(existingById.keys());

  for (const draft of drafts) {
    if (!draft.id) continue;
    if (!existingById.has(draft.id)) {
      throw new ValidationError(
        "block draft identity is not a live page block",
      );
    }
    result.set(draft.clientRef, draft.id);
  }
  for (const draft of drafts) {
    if (draft.id) continue;
    const id = asNativeId(dependencies.newId());
    if (assignedIds.has(id)) {
      throw new ValidationError("generated block identity is duplicated");
    }
    assignedIds.add(id);
    result.set(draft.clientRef, id);
  }
  return result;
}

function buildCandidateBlocks(
  drafts: readonly ParsedDraft[],
  idsByRef: ReadonlyMap<string, NativeId>,
  existingById: ReadonlyMap<NativeId, Block>,
  pageId: NativeId,
  timestampForMutation: () => string,
): readonly CandidateBlock[] {
  const siblingPositions = new Map<string, number>();

  return drafts.map((draft) => {
    const id = idsByRef.get(draft.clientRef);
    if (!id) {
      throw new ValidationError("block draft identity is missing");
    }
    const parentBlockId = draft.parentClientRef
      ? idsByRef.get(draft.parentClientRef)
      : null;
    if (draft.parentClientRef && !parentBlockId) {
      throw new ValidationError("block draft parent does not exist");
    }
    const siblingKey = parentBlockId ?? "root";
    const position = siblingPositions.get(siblingKey) ?? 0;
    siblingPositions.set(siblingKey, position + 1);
    const existing = existingById.get(id);
    const unchanged =
      existing !== undefined &&
      existing.pageId === pageId &&
      existing.parentBlockId === parentBlockId &&
      existing.position === position &&
      existing.blockType === "paragraph" &&
      existing.content.text === draft.content.text;
    const candidate = unchanged
      ? existing
      : freezeBlock({
          id,
          pageId,
          parentBlockId: parentBlockId ?? null,
          blockType: "paragraph",
          position,
          content: draft.content,
          createdAt: existing?.createdAt ?? timestampForMutation(),
          updatedAt: timestampForMutation(),
          archivedAt: null,
        });
    return Object.freeze({
      block: candidate,
      isChanged: !unchanged,
    });
  });
}

function validateLiveBlockTree(blocks: readonly Block[]): void {
  const byId = new Map<NativeId, Block>();
  const siblingPositions = new Map<string, Set<number>>();
  let totalTextLength = 0;

  for (const currentBlock of blocks) {
    if (byId.has(currentBlock.id)) {
      throw new ValidationError(
        "current document block identity is duplicated",
      );
    }
    byId.set(currentBlock.id, currentBlock);
    totalTextLength += currentBlock.content.text.length;
    if (totalTextLength > MAX_DOCUMENT_TEXT_LENGTH) {
      throw new ValidationError("block document text exceeds the limit");
    }
    const siblingKey = currentBlock.parentBlockId ?? "root";
    const positions = siblingPositions.get(siblingKey) ?? new Set<number>();
    if (positions.has(currentBlock.position)) {
      throw new ValidationError(
        "current document sibling position is duplicated",
      );
    }
    positions.add(currentBlock.position);
    siblingPositions.set(siblingKey, positions);
  }

  const visiting = new Set<NativeId>();
  const depths = new Map<NativeId, number>();
  const depthFor = (id: NativeId): number => {
    const known = depths.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) {
      throw new ValidationError(
        "current document parent graph contains a cycle",
      );
    }
    const currentBlock = byId.get(id);
    if (!currentBlock) {
      throw new ValidationError("current document parent does not exist");
    }
    visiting.add(id);
    const depth = currentBlock.parentBlockId
      ? depthFor(currentBlock.parentBlockId) + 1
      : 1;
    visiting.delete(id);
    if (depth > MAX_NESTING_DEPTH) {
      throw new ValidationError("block document exceeds the nesting limit");
    }
    depths.set(id, depth);
    return depth;
  };

  for (const currentBlock of blocks) depthFor(currentBlock.id);
}

function normaliseBlockOrder(blocks: readonly Block[]): readonly Block[] {
  const children = new Map<string, Block[]>();
  for (const currentBlock of blocks) {
    const parentKey = currentBlock.parentBlockId ?? "root";
    const siblingBlocks = children.get(parentKey) ?? [];
    siblingBlocks.push(currentBlock);
    children.set(parentKey, siblingBlocks);
  }
  for (const siblingBlocks of children.values()) {
    siblingBlocks.sort(
      (left, right) =>
        left.position - right.position || left.id.localeCompare(right.id),
    );
  }

  const ordered: Block[] = [];
  const visit = (parentBlockId: NativeId | null): void => {
    for (const currentBlock of children.get(parentBlockId ?? "root") ?? []) {
      ordered.push(currentBlock);
      visit(currentBlock.id);
    }
  };
  visit(null);
  if (ordered.length !== blocks.length) {
    throw new ValidationError("current document parent graph is invalid");
  }
  return Object.freeze(ordered);
}

function validateParagraphContent(value: unknown): ParagraphContent {
  if (!isPlainRecord(value)) {
    throw new ValidationError("paragraph content is invalid");
  }
  assertExactKeys(value, ["text"], "paragraph content");
  if (typeof value.text !== "string") {
    throw new ValidationError("paragraph text is invalid");
  }
  if (value.text.length > MAX_PARAGRAPH_TEXT_LENGTH) {
    throw new ValidationError("paragraph text exceeds the limit");
  }
  return Object.freeze({ text: value.text });
}

function freezeBlock(value: Block): Block {
  return Object.freeze({
    ...value,
    content: Object.freeze({ text: value.content.text }),
  });
}

function freezeDocument(
  pageId: NativeId,
  revisionNumber: number,
  blocks: readonly Block[],
): BlockDocument {
  return Object.freeze({
    pageId,
    revisionNumber,
    blocks: Object.freeze([...blocks]),
  });
}

function requireRevisionNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ValidationError(name + " must be a non-negative safe integer");
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ValidationError(name + " must be a non-negative safe integer");
  }
  return value;
}

function requireClientRef(value: string): string {
  if (!CLIENT_REF_PATTERN.test(value)) {
    throw new ValidationError("block draft client reference is invalid");
  }
  return value;
}

function validateBoundedText(
  value: unknown,
  name: string,
  maximum: number,
): string {
  if (typeof value !== "string") {
    throw new ValidationError(name + " must be a string");
  }
  const normalised = value.trim();
  if (normalised.length === 0 || normalised.length > maximum) {
    throw new ValidationError(name + " is invalid");
  }
  return normalised;
}

function canonicalTimestamp(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ValidationError("block timestamp is invalid");
  }
  return value.toISOString();
}

function requireString(
  value: Readonly<Record<string, unknown>>,
  key: string,
  context: string,
): string {
  const candidate = value[key];
  if (typeof candidate !== "string") {
    throw new ValidationError(context + " " + key + " must be a string");
  }
  return candidate;
}

function assertExactKeys(
  value: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
  context: string,
): void {
  const keys = Object.keys(value);
  if (
    Object.getOwnPropertySymbols(value).length > 0 ||
    keys.some((key) => !allowedKeys.includes(key))
  ) {
    throw new ValidationError(context + " contains unsupported fields");
  }
  for (const requiredKey of allowedKeys) {
    if (
      requiredKey !== "id" &&
      requiredKey !== "parentClientRef" &&
      requiredKey !== "requestId" &&
      requiredKey !== "reason" &&
      !Object.prototype.hasOwnProperty.call(value, requiredKey)
    ) {
      throw new ValidationError(context + " is missing " + requiredKey);
    }
  }
}

function isPlainRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
