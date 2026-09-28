import type { AuditActorType, AuditEvent, Revision } from "./audit.ts";
import { asNativeId, ValidationError, type NativeId } from "./ids.ts";

export interface PageLink {
  readonly id: NativeId;
  readonly sourcePageId: NativeId;
  readonly targetPageId: NativeId;
  readonly createdAt: string;
  readonly archivedAt: string | null;
  readonly provenance: Readonly<{ source: string; actorId: string }>;
}
export interface PageLinkCommand {
  readonly sourcePageId: NativeId;
  readonly targetPageId: NativeId;
  readonly actorType: AuditActorType;
  readonly actorId: string;
  readonly source: string;
}
export interface PageLinkDependencies {
  readonly newId: () => string;
  readonly now: () => Date;
}
export interface CreatePageLinkMutation {
  readonly link: PageLink;
  readonly revision: Revision<PageLink, "page-link">;
  readonly audit: AuditEvent<PageLink, "page-link", "page.linked">;
}
export interface ArchivePageLinkMutation {
  readonly link: PageLink;
  readonly revision: Revision<PageLink, "page-link">;
  readonly audit: AuditEvent<PageLink, "page-link", "page.unlinked">;
}

export function createPageLink(
  command: PageLinkCommand,
  dependencies: PageLinkDependencies,
): CreatePageLinkMutation {
  const sourcePageId = asNativeId(command.sourcePageId);
  const targetPageId = asNativeId(command.targetPageId);
  if (sourcePageId === targetPageId)
    throw new ValidationError("page cannot link to itself");
  const actorId = text(command.actorId, "actor ID");
  const source = text(command.source, "source");
  const timestamp = dependencies.now().toISOString();
  const link = Object.freeze({
    id: asNativeId(dependencies.newId()),
    sourcePageId,
    targetPageId,
    createdAt: timestamp,
    archivedAt: null,
    provenance: Object.freeze({ source, actorId }),
  });
  return Object.freeze({
    link,
    revision: Object.freeze({
      id: asNativeId(dependencies.newId()),
      entityType: "page-link" as const,
      entityId: link.id,
      revisionNumber: 1,
      createdAt: timestamp,
      snapshot: link,
    }),
    audit: Object.freeze({
      id: asNativeId(dependencies.newId()),
      timestamp,
      actorType: command.actorType,
      actorId,
      action: "page.linked" as const,
      targetType: "page-link" as const,
      targetId: link.id,
      source,
      before: null,
      after: link,
    }),
  });
}

export function archivePageLink(
  current: PageLink,
  currentRevisionNumber: number,
  command: Pick<PageLinkCommand, "actorType" | "actorId" | "source">,
  dependencies: PageLinkDependencies,
): ArchivePageLinkMutation {
  if (current.archivedAt !== null)
    throw new ValidationError("page link is archived");
  if (!Number.isSafeInteger(currentRevisionNumber) || currentRevisionNumber < 1)
    throw new ValidationError("current revision number is invalid");
  const actorId = text(command.actorId, "actor ID");
  const source = text(command.source, "source");
  const timestamp = dependencies.now().toISOString();
  const link = Object.freeze({ ...current, archivedAt: timestamp });
  return Object.freeze({
    link,
    revision: Object.freeze({
      id: asNativeId(dependencies.newId()),
      entityType: "page-link" as const,
      entityId: link.id,
      revisionNumber: currentRevisionNumber + 1,
      createdAt: timestamp,
      snapshot: link,
    }),
    audit: Object.freeze({
      id: asNativeId(dependencies.newId()),
      timestamp,
      actorType: command.actorType,
      actorId,
      action: "page.unlinked" as const,
      targetType: "page-link" as const,
      targetId: link.id,
      source,
      before: current,
      after: link,
    }),
  });
}

function text(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new ValidationError(`${label} must not be empty`);
  return result;
}
