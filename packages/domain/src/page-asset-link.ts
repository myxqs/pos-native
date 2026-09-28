import type { AuditActorType, AuditEvent, Revision } from "./audit.ts";
import { asNativeId, ValidationError, type NativeId } from "./ids.ts";

export interface PageAssetLink {
  readonly id: NativeId;
  readonly pageId: NativeId;
  readonly assetId: NativeId;
  readonly createdAt: string;
  readonly archivedAt: string | null;
  readonly provenance: Readonly<{ source: string; actorId: string }>;
}

export interface CreatePageAssetLinkCommand {
  readonly pageId: NativeId;
  readonly assetId: NativeId;
  readonly actorType: AuditActorType;
  readonly actorId: string;
  readonly source: string;
}

export interface PageAssetLinkDependencies {
  readonly newId: () => string;
  readonly now: () => Date;
}

export interface CreatePageAssetLinkMutation {
  readonly link: PageAssetLink;
  readonly revision: Revision<PageAssetLink, "page-asset-link">;
  readonly audit: AuditEvent<
    PageAssetLink,
    "page-asset-link",
    "page.asset-linked"
  >;
}

export interface ArchivePageAssetLinkMutation {
  readonly link: PageAssetLink;
  readonly revision: Revision<PageAssetLink, "page-asset-link">;
  readonly audit: AuditEvent<
    PageAssetLink,
    "page-asset-link",
    "page.asset-unlinked"
  >;
}

export class PageAssetLinkArchiveStateError extends Error {
  constructor() {
    super("page asset link is archived");
    this.name = "PageAssetLinkArchiveStateError";
  }
}

export function createPageAssetLink(
  command: CreatePageAssetLinkCommand,
  dependencies: PageAssetLinkDependencies,
): CreatePageAssetLinkMutation {
  const actorId = canonicalText(command.actorId, "actor ID");
  const source = canonicalText(command.source, "source");
  const timestamp = dependencies.now().toISOString();
  const link = Object.freeze({
    id: asNativeId(dependencies.newId()),
    pageId: asNativeId(command.pageId),
    assetId: asNativeId(command.assetId),
    createdAt: timestamp,
    archivedAt: null,
    provenance: Object.freeze({ source, actorId }),
  });
  return Object.freeze({
    link,
    revision: Object.freeze({
      id: asNativeId(dependencies.newId()),
      entityType: "page-asset-link" as const,
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
      action: "page.asset-linked" as const,
      targetType: "page-asset-link" as const,
      targetId: link.id,
      source,
      before: null,
      after: link,
    }),
  });
}

export function archivePageAssetLink(
  current: PageAssetLink,
  currentRevisionNumber: number,
  command: Pick<CreatePageAssetLinkCommand, "actorType" | "actorId" | "source">,
  dependencies: PageAssetLinkDependencies,
): ArchivePageAssetLinkMutation {
  if (current.archivedAt !== null) throw new PageAssetLinkArchiveStateError();
  if (!Number.isSafeInteger(currentRevisionNumber) || currentRevisionNumber < 1)
    throw new ValidationError("current revision number is invalid");
  const actorId = canonicalText(command.actorId, "actor ID");
  const source = canonicalText(command.source, "source");
  const timestamp = dependencies.now().toISOString();
  const link = Object.freeze({ ...current, archivedAt: timestamp });
  return Object.freeze({
    link,
    revision: Object.freeze({
      id: asNativeId(dependencies.newId()),
      entityType: "page-asset-link" as const,
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
      action: "page.asset-unlinked" as const,
      targetType: "page-asset-link" as const,
      targetId: link.id,
      source,
      before: current,
      after: link,
    }),
  });
}

function canonicalText(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new ValidationError(`${label} must not be empty`);
  return result;
}
