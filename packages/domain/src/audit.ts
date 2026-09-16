import type { NativeId } from "./ids.ts";

export type AuditActorType = "user" | "api-token" | "importer" | "system";

export interface Revision<TSnapshot> {
  readonly id: NativeId;
  readonly entityType: "page";
  readonly entityId: NativeId;
  readonly revisionNumber: 1;
  readonly createdAt: string;
  readonly snapshot: TSnapshot;
}

export interface AuditEvent<TSnapshot> {
  readonly id: NativeId;
  readonly timestamp: string;
  readonly actorType: AuditActorType;
  readonly actorId: string;
  readonly action: "page.created";
  readonly targetType: "page";
  readonly targetId: NativeId;
  readonly source: string;
  readonly before: null;
  readonly after: TSnapshot;
}
