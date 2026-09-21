import type { AuditActorType, AuditEvent, Revision } from "./audit.ts";
import { asNativeId, type NativeId, ValidationError } from "./ids.ts";

const AUDIT_ACTOR_TYPES: ReadonlySet<AuditActorType> = new Set([
  "user",
  "api-token",
  "importer",
  "system",
]);

interface PageAuditContext {
  readonly actorType: AuditActorType;
  readonly actorId: string;
  readonly source: string;
}

export interface CreatePageCommand extends PageAuditContext {
  readonly title: string;
  readonly parentId?: NativeId | null;
}

export interface CreatePageDependencies {
  readonly newId: () => string;
  readonly now: () => Date;
}

export interface Page {
  readonly id: NativeId;
  readonly parentId: NativeId | null;
  readonly title: string;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly modifiedAt: string;
  readonly provenance: {
    readonly source: string;
    readonly actorId: string;
  };
}

export interface CreatePageMutation {
  readonly page: Page;
  readonly revision: Revision<Page, "page">;
  readonly audit: AuditEvent<Page, "page", "page.created">;
}

export interface UpdatePageCommand extends PageAuditContext {
  readonly title: string;
}

export interface MovePageCommand extends PageAuditContext {
  readonly parentId: NativeId | null;
}

export type ArchivePageCommand = PageAuditContext;

export interface RestorePageCommand extends PageAuditContext {
  readonly parentId: NativeId | null;
}

type PageUpdateAction =
  "page.updated" | "page.moved" | "page.archived" | "page.restored";

interface PageMutation<TAction extends PageUpdateAction> {
  readonly page: Page;
  readonly revision: Revision<Page, "page">;
  readonly audit: AuditEvent<Page, "page", TAction>;
}

export type UpdatePageMutation = PageMutation<"page.updated">;
export type MovePageMutation = PageMutation<"page.moved">;
export type ArchivePageMutation = PageMutation<"page.archived">;
export type RestorePageMutation = PageMutation<"page.restored">;

export type PageUpdateMutation =
  | UpdatePageMutation
  | MovePageMutation
  | ArchivePageMutation
  | RestorePageMutation;

export class PageArchiveStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageArchiveStateError";
  }
}

export function createPage(
  command: CreatePageCommand,
  dependencies: CreatePageDependencies,
): CreatePageMutation {
  const context = validatePageAuditContext(command);
  const title = validateTitle(command.title);
  const parentId = validateParentId(command.parentId);

  const pageId = asNativeId(dependencies.newId());
  const revisionId = asNativeId(dependencies.newId());
  const auditId = asNativeId(dependencies.newId());
  const timestamp = dependencies.now().toISOString();
  const page: Page = Object.freeze({
    id: pageId,
    parentId,
    title,
    archivedAt: null,
    createdAt: timestamp,
    modifiedAt: timestamp,
    provenance: Object.freeze({
      source: context.source,
      actorId: context.actorId,
    }),
  });

  return Object.freeze({
    page,
    revision: Object.freeze({
      id: revisionId,
      entityType: "page",
      entityId: pageId,
      revisionNumber: 1,
      createdAt: timestamp,
      snapshot: page,
    }),
    audit: Object.freeze({
      id: auditId,
      timestamp,
      actorType: context.actorType,
      actorId: context.actorId,
      action: "page.created",
      targetType: "page",
      targetId: pageId,
      source: context.source,
      before: null,
      after: page,
    }),
  });
}

export function updatePage(
  current: Page,
  currentRevisionNumber: number,
  command: UpdatePageCommand,
  dependencies: CreatePageDependencies,
): UpdatePageMutation {
  const context = validatePageAuditContext(command);
  const title = validateTitle(command.title);
  validateCurrentRevisionNumber(currentRevisionNumber);
  assertLivePage(current);

  const timestamp = dependencies.now().toISOString();
  const page: Page = Object.freeze({
    ...current,
    title,
    modifiedAt: timestamp,
    provenance: Object.freeze({
      source: context.source,
      actorId: context.actorId,
    }),
  });

  return createPageUpdateMutation(
    current,
    page,
    currentRevisionNumber,
    context,
    dependencies,
    timestamp,
    "page.updated",
  );
}

export function movePage(
  current: Page,
  currentRevisionNumber: number,
  command: MovePageCommand,
  dependencies: CreatePageDependencies,
): MovePageMutation {
  const context = validatePageAuditContext(command);
  const parentId = validateParentId(command.parentId);
  validateCurrentRevisionNumber(currentRevisionNumber);
  assertLivePage(current);

  const timestamp = dependencies.now().toISOString();
  const page = withPageChanges(current, context, timestamp, { parentId });

  return createPageUpdateMutation(
    current,
    page,
    currentRevisionNumber,
    context,
    dependencies,
    timestamp,
    "page.moved",
  );
}

export function archivePage(
  current: Page,
  currentRevisionNumber: number,
  command: ArchivePageCommand,
  dependencies: CreatePageDependencies,
): ArchivePageMutation {
  const context = validatePageAuditContext(command);
  validateCurrentRevisionNumber(currentRevisionNumber);
  assertLivePage(current);

  const timestamp = dependencies.now().toISOString();
  const page = withPageChanges(current, context, timestamp, {
    archivedAt: timestamp,
  });

  return createPageUpdateMutation(
    current,
    page,
    currentRevisionNumber,
    context,
    dependencies,
    timestamp,
    "page.archived",
  );
}

export function restorePage(
  current: Page,
  currentRevisionNumber: number,
  command: RestorePageCommand,
  dependencies: CreatePageDependencies,
): RestorePageMutation {
  const context = validatePageAuditContext(command);
  const parentId = validateParentId(command.parentId);
  validateCurrentRevisionNumber(currentRevisionNumber);
  if (current.archivedAt === null) {
    throw new PageArchiveStateError("page is not archived");
  }

  const timestamp = dependencies.now().toISOString();
  const page = withPageChanges(current, context, timestamp, {
    parentId,
    archivedAt: null,
  });

  return createPageUpdateMutation(
    current,
    page,
    currentRevisionNumber,
    context,
    dependencies,
    timestamp,
    "page.restored",
  );
}

function validatePageAuditContext(command: PageAuditContext): {
  actorType: AuditActorType;
  actorId: string;
  source: string;
} {
  if (!AUDIT_ACTOR_TYPES.has(command.actorType)) {
    throw new ValidationError("actor type is not supported");
  }

  const actorId = command.actorId.trim();
  if (!actorId) {
    throw new ValidationError("actor ID must not be empty");
  }

  const source = command.source.trim();
  if (!source) {
    throw new ValidationError("source must not be empty");
  }

  return { actorType: command.actorType, actorId, source };
}

function validateTitle(value: string): string {
  const title = value.trim();
  if (!title) {
    throw new ValidationError("title must not be empty");
  }

  return title;
}

function validateParentId(
  parentId: NativeId | null | undefined,
): NativeId | null {
  if (parentId === null || parentId === undefined) {
    return null;
  }

  return asNativeId(parentId);
}

function validateCurrentRevisionNumber(currentRevisionNumber: number): void {
  if (
    !Number.isSafeInteger(currentRevisionNumber) ||
    currentRevisionNumber < 1
  ) {
    throw new ValidationError(
      "current revision number must be a positive integer",
    );
  }
}

function assertLivePage(current: Page): void {
  if (current.archivedAt !== null) {
    throw new PageArchiveStateError("page is archived");
  }
}

function withPageChanges(
  current: Page,
  context: ReturnType<typeof validatePageAuditContext>,
  timestamp: string,
  changes: Partial<Pick<Page, "parentId" | "archivedAt">>,
): Page {
  return Object.freeze({
    ...current,
    ...changes,
    modifiedAt: timestamp,
    provenance: Object.freeze({
      source: context.source,
      actorId: context.actorId,
    }),
  });
}

function createPageUpdateMutation<TAction extends PageUpdateAction>(
  current: Page,
  page: Page,
  currentRevisionNumber: number,
  context: ReturnType<typeof validatePageAuditContext>,
  dependencies: CreatePageDependencies,
  timestamp: string,
  action: TAction,
): PageMutation<TAction> {
  return Object.freeze({
    page,
    revision: Object.freeze({
      id: asNativeId(dependencies.newId()),
      entityType: "page",
      entityId: page.id,
      revisionNumber: currentRevisionNumber + 1,
      createdAt: timestamp,
      snapshot: page,
    }),
    audit: Object.freeze({
      id: asNativeId(dependencies.newId()),
      timestamp,
      actorType: context.actorType,
      actorId: context.actorId,
      action,
      targetType: "page",
      targetId: page.id,
      source: context.source,
      before: current,
      after: page,
    }),
  });
}
