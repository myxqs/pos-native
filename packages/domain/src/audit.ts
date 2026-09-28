import type { NativeId } from "./ids.ts";

export type AuditActorType = "user" | "api-token" | "importer" | "system";
export type NativeEntityType =
  | "page"
  | "asset"
  | "block-document"
  | "data-source"
  | "property-definition"
  | "record-property"
  | "relation-edge"
  | "page-asset-link"
  | "page-link";
export type AuditAction =
  | "page.created"
  | "page.updated"
  | "page.moved"
  | "page.archived"
  | "page.restored"
  | "asset.created"
  | "block-document.updated"
  | "data-source.created"
  | "property-definition.created"
  | "record-property.created"
  | "record-property.updated"
  | "relation-edge.created"
  | "relation-edge.archived"
  | "page.asset-linked"
  | "page.asset-unlinked"
  | "page.linked"
  | "page.unlinked";

export interface Revision<
  TSnapshot,
  TEntityType extends NativeEntityType = NativeEntityType,
> {
  readonly id: NativeId;
  readonly entityType: TEntityType;
  readonly entityId: NativeId;
  readonly revisionNumber: number;
  readonly createdAt: string;
  readonly snapshot: TSnapshot;
}

export interface AuditEvent<
  TSnapshot,
  TTargetType extends NativeEntityType = NativeEntityType,
  TAction extends AuditAction = AuditAction,
> {
  readonly id: NativeId;
  readonly timestamp: string;
  readonly actorType: AuditActorType;
  readonly actorId: string;
  readonly action: TAction;
  readonly targetType: TTargetType;
  readonly targetId: NativeId;
  readonly requestId?: NativeId;
  readonly idempotencyKey?: string;
  readonly source: string;
  readonly reason?: string;
  readonly before: TSnapshot | null;
  readonly after: TSnapshot;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
