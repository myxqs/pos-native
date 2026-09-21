import { and, asc, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { AuditEvent, Revision } from "../../domain/src/audit.ts";
import {
  asAssetStorageKey,
  normaliseAssetMetadata,
  storageKeyForAsset,
  validateAssetByteSize,
  validateAssetSha256,
  type Asset,
  type CreateAssetMutation,
} from "../../domain/src/asset.ts";
import { asNativeId, type NativeId } from "../../domain/src/ids.ts";
import type {
  AssetMetadataRepository,
  PersistedAssetMetadata,
} from "./asset-metadata-repository.ts";
import { assets, auditEvents, revisions } from "./schema.ts";
import type * as schema from "./schema.ts";

type Database = NodePgDatabase<typeof schema>;

export class PostgresAssetMetadataRepository implements AssetMetadataRepository {
  constructor(private readonly database: Database) {}

  async create(mutation: CreateAssetMutation): Promise<Asset> {
    return this.database.transaction(async (transaction) => {
      await transaction.insert(assets).values(toAssetRow(mutation.asset));
      await transaction
        .insert(revisions)
        .values(toRevisionRow(mutation.revision));
      await transaction.insert(auditEvents).values(toAuditRow(mutation.audit));
      return mutation.asset;
    });
  }

  async getById(id: NativeId): Promise<PersistedAssetMetadata | null> {
    const rows = await this.database
      .select()
      .from(assets)
      .where(eq(assets.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;

    const asset = fromAssetRow(row);
    const revisionRows = await this.database
      .select({
        revisionNumber: revisions.revisionNumber,
        snapshot: revisions.snapshot,
      })
      .from(revisions)
      .where(
        and(
          eq(revisions.entityType, "asset"),
          eq(revisions.entityId, asset.id),
        ),
      )
      .orderBy(desc(revisions.revisionNumber))
      .limit(1);
    const revision = revisionRows[0];
    if (
      !revision ||
      revision.revisionNumber !== 1 ||
      !assetSnapshotMatches(revision.snapshot, asset)
    ) {
      throw new Error("asset revision history is invalid");
    }

    return { asset, revisionNumber: revision.revisionNumber };
  }

  async list(): Promise<readonly Asset[]> {
    const rows = await this.database
      .select()
      .from(assets)
      .orderBy(asc(assets.createdAt), asc(assets.id));
    return rows.map(fromAssetRow);
  }
}

function toAssetRow(asset: Asset): typeof assets.$inferInsert {
  return {
    id: asset.id,
    originalFilename: asset.originalFilename,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    sha256: asset.sha256,
    storageKey: asset.storageKey,
    createdAt: new Date(asset.createdAt),
    provenance: { ...asset.provenance },
  };
}

function toRevisionRow(
  revision: Revision<Asset, "asset">,
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
  audit: AuditEvent<Asset, "asset", "asset.created">,
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

function fromAssetRow(row: typeof assets.$inferSelect): Asset {
  const id = asNativeId(row.id);
  const metadata = normaliseAssetMetadata({
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
  });
  if (
    metadata.originalFilename !== row.originalFilename ||
    metadata.mimeType !== row.mimeType
  ) {
    throw new Error("asset metadata is not canonical");
  }
  const storageKey = asAssetStorageKey(row.storageKey);
  if (storageKey !== storageKeyForAsset(id)) {
    throw new Error("asset storage key is invalid");
  }
  validateAssetByteSize(row.byteSize, Number.MAX_SAFE_INTEGER);
  validateAssetSha256(row.sha256);
  const createdAt = canonicalTimestamp(row.createdAt);
  const provenance = normaliseStoredProvenance(row.provenance);

  return Object.freeze({
    id,
    originalFilename: metadata.originalFilename,
    mimeType: metadata.mimeType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    storageKey,
    createdAt,
    provenance,
  });
}

function normaliseStoredProvenance(
  value: Record<string, string>,
): Readonly<Record<string, string>> {
  if (!isStringRecord(value)) {
    throw new Error("asset provenance is invalid");
  }
  const allowed = new Set(["source", "actorId", "requestId", "runId"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error("asset provenance is invalid");
  }
  const source = canonicalText(value.source, 128);
  const actorId = canonicalText(value.actorId, 255);
  const provenance: Record<string, string> = { source, actorId };
  if (value.requestId !== undefined) {
    const requestId = asNativeId(canonicalText(value.requestId, 36));
    provenance.requestId = requestId;
  }
  if (value.runId !== undefined) {
    const runId = canonicalText(value.runId, 128);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(runId)) {
      throw new Error("asset provenance is invalid");
    }
    provenance.runId = runId;
  }
  return Object.freeze(provenance);
}

function canonicalText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum
  ) {
    throw new Error("asset provenance is invalid");
  }
  if (value.trim() !== value) {
    throw new Error("asset provenance is invalid");
  }
  return value;
}

function canonicalTimestamp(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("asset timestamp is invalid");
  }
  return value.toISOString();
}

function assetSnapshotMatches(
  snapshot: Record<string, unknown>,
  asset: Asset,
): boolean {
  if (!isUnknownRecord(snapshot) || !isUnknownRecord(snapshot.provenance)) {
    return false;
  }
  const provenance = snapshot.provenance;
  return (
    snapshot.id === asset.id &&
    snapshot.originalFilename === asset.originalFilename &&
    snapshot.mimeType === asset.mimeType &&
    snapshot.byteSize === asset.byteSize &&
    snapshot.sha256 === asset.sha256 &&
    snapshot.storageKey === asset.storageKey &&
    snapshot.createdAt === asset.createdAt &&
    sameStringRecord(provenance, asset.provenance)
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isUnknownRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameStringRecord(
  left: Record<string, unknown>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value]) => right[key] === value)
  );
}

function toJsonObject(value: object): Record<string, unknown> {
  return { ...value };
}
