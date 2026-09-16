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
  readonly archivedAt: null;
  readonly createdAt: string;
  readonly modifiedAt: string;
  readonly provenance: {
    readonly source: string;
    readonly actorId: string;
  };
}

export interface CreatePageMutation {
  readonly page: Page;
  readonly revision: Revision<Page>;
  readonly audit: AuditEvent<Page>;
}

export function createPage(
  command: CreatePageCommand,
  dependencies: CreatePageDependencies,
): CreatePageMutation {
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
