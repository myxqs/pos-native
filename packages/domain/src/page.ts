import type { AuditActorType, AuditEvent, Revision } from "./audit.ts";
import { asNativeId, type NativeId, ValidationError } from "./ids.ts";

const AUDIT_ACTOR_TYPES: ReadonlySet<AuditActorType> = new Set([
  "user",
  "api-token",
  "importer",
  "system",
]);

export interface CreatePageCommand {
  readonly title: string;
  readonly actorType: AuditActorType;
  readonly actorId: string;
  readonly source: string;
}

export interface CreatePageDependencies {
  readonly newId: () => string;
  readonly now: () => Date;
}

export interface Page {
  readonly id: NativeId;
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

export type UpdatePageCommand = CreatePageCommand;

export interface UpdatePageMutation {
  readonly page: Page;
  readonly revision: Revision<Page, "page">;
  readonly audit: AuditEvent<Page, "page", "page.updated">;
}

export function createPage(
  command: CreatePageCommand,
  dependencies: CreatePageDependencies,
): CreatePageMutation {
  const { title, actorId, source } = validatePageCommand(command);

  const pageId = asNativeId(dependencies.newId());
  const revisionId = asNativeId(dependencies.newId());
  const auditId = asNativeId(dependencies.newId());
  const timestamp = dependencies.now().toISOString();
  const page: Page = Object.freeze({
    id: pageId,
    title,
    archivedAt: null,
    createdAt: timestamp,
    modifiedAt: timestamp,
    provenance: Object.freeze({ source, actorId }),
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
      actorType: command.actorType,
      actorId,
      action: "page.created",
      targetType: "page",
      targetId: pageId,
      source,
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
  const { title, actorId, source } = validatePageCommand(command);
  if (
    !Number.isSafeInteger(currentRevisionNumber) ||
    currentRevisionNumber < 1
  ) {
    throw new ValidationError(
      "current revision number must be a positive integer",
    );
  }

  const timestamp = dependencies.now().toISOString();
  const page: Page = Object.freeze({
    ...current,
    title,
    modifiedAt: timestamp,
    provenance: Object.freeze({ source, actorId }),
  });

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
      actorType: command.actorType,
      actorId,
      action: "page.updated",
      targetType: "page",
      targetId: page.id,
      source,
      before: current,
      after: page,
    }),
  });
}

function validatePageCommand(command: CreatePageCommand): {
  title: string;
  actorId: string;
  source: string;
} {
  const title = command.title.trim();
  if (!title) {
    throw new ValidationError("title must not be empty");
  }

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

  return { title, actorId, source };
}
